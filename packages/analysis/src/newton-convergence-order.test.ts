/**
 * P5.19's validation criterion is "slope doubling per iter near root (assert
 * last-3 ratio)". The final test in this file is that criterion, measured on a
 * real `newtonShooting` solve rather than on a synthetic sequence — a plot
 * that claims a quadratic tail is only worth drawing if the solver actually
 * has one.
 *
 * The synthetic tests come first because they pin the arithmetic to sequences
 * whose answer is known exactly. A test that only ever sees a real solve
 * cannot distinguish "the ratio function is right" from "the solver happened
 * to converge", and would silently accept an off-by-one in the windowing.
 */

import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import {
  finalMeritSlopeRatio,
  meritLogSlopes,
  meritSlopeRatios,
  plottableTracePoints,
  type NewtonTracePoint,
} from "./newton-convergence-order.js";
import { newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

function points(...merits: readonly number[]): NewtonTracePoint[] {
  return merits.map((merit, iteration) => ({ iteration, merit }));
}

/**
 * An exactly quadratic sequence: `‖F₍ₖ₊₁₎‖ = C‖Fₖ‖²`. Every slope ratio is 2
 * to floating-point, whatever `C` and the starting residual are — which is the
 * property that makes the ratio a usable diagnostic.
 */
function quadraticSequence(first: number, constant: number, count: number): NewtonTracePoint[] {
  const merits = [first];
  while (merits.length < count) {
    const previous = merits[merits.length - 1]!;
    merits.push(constant * previous * previous);
  }
  return points(...merits);
}

describe("plottableTracePoints", () => {
  it("keeps the points a log axis can show", () => {
    expect(plottableTracePoints(points(1, 1e-3, 1e-9))).toHaveLength(3);
  });

  it("drops a zero residual rather than clamping it, because log 0 is not a value", () => {
    // A solve that lands exactly on the target reports ‖F‖ = 0; the plot cannot
    // draw "infinitely many correct digits" and must not invent a finite one.
    expect(plottableTracePoints(points(1, 1e-6, 0))).toEqual([
      { iteration: 0, merit: 1 },
      { iteration: 1, merit: 1e-6 },
    ]);
  });

  it("drops non-finite residuals", () => {
    expect(plottableTracePoints(points(1, Number.NaN, Number.POSITIVE_INFINITY, -1))).toEqual([
      { iteration: 0, merit: 1 },
    ]);
  });
});

describe("meritLogSlopes", () => {
  it("returns one fewer slope than there are points", () => {
    expect(meritLogSlopes(points(1, 1e-2, 1e-6))).toHaveLength(2);
  });

  it("measures a decade per iteration as a slope of -1", () => {
    expect(meritLogSlopes(points(1, 0.1, 0.01))).toEqual([-1, -1]);
  });

  it("has no slopes to report for a single point", () => {
    expect(meritLogSlopes(points(1))).toEqual([]);
    expect(meritLogSlopes([])).toEqual([]);
  });
});

describe("meritSlopeRatios", () => {
  it("is 2 at every step of an exactly quadratic sequence", () => {
    // n points -> n-1 slopes -> n-2 ratios.
    const ratios = meritSlopeRatios(quadraticSequence(0.5, 3, 6));

    expect(ratios).toHaveLength(4);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(2, 9);
  });

  it("is 2 regardless of the unknown constant C, which cancels", () => {
    // The whole reason the diagnostic is a ratio: C is never known in practice.
    for (const constant of [1e-3, 1, 250]) {
      const ratios = meritSlopeRatios(quadraticSequence(0.2, constant, 5));
      for (const ratio of ratios) expect(ratio).toBeCloseTo(2, 9);
    }
  });

  it("is 1 for a linearly convergent sequence, distinguishing the two regimes", () => {
    const ratios = meritSlopeRatios(points(1, 0.1, 0.01, 1e-3));

    expect(ratios).toHaveLength(2);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(1, 9);
  });

  it("omits a ratio whose denominator is a stalled step rather than reporting infinity", () => {
    // A rejected step (alpha = 0) leaves the iterate untouched, so the residual
    // repeats exactly and the slope into it is 0. Dividing by it is not a
    // measurement of anything.
    const ratios = meritSlopeRatios(points(1, 1, 1e-4));

    expect(ratios).toEqual([]);
  });
});

describe("finalMeritSlopeRatio", () => {
  it("uses only the last three residuals, ignoring the pre-asymptotic head", () => {
    // A slow head followed by a quadratic tail: a fit over all of it would be
    // dragged towards 1, the three-point window reports the tail.
    const ratio = finalMeritSlopeRatio(points(10, 5, 2.5, 1e-2, 1e-5, 1e-11));

    expect(ratio).toBeCloseTo(2, 6);
  });

  it("has no measurement to give from fewer than three points", () => {
    expect(finalMeritSlopeRatio(points(1, 1e-6))).toBeUndefined();
    expect(finalMeritSlopeRatio(points(1))).toBeUndefined();
    expect(finalMeritSlopeRatio([])).toBeUndefined();
  });

  it("has no measurement to give when a zero residual leaves fewer than three plottable points", () => {
    expect(finalMeritSlopeRatio(points(1, 1e-6, 0))).toBeUndefined();
  });

  it("has no measurement to give when the earlier slope is a stall", () => {
    expect(finalMeritSlopeRatio(points(1, 1, 1e-8))).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// The criterion, on a real solve.
// --------------------------------------------------------------------------

const TIGHT_TOL = {
  stepper: "dopri5" as const,
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/** Matches the inner solve's tolerance, per `JacobianOptions.noiseFloor`. */
const NOISE_FLOOR = 1e-12;

function context(dragCoefficient: number, wind: number) {
  return createEvalContext(
    new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(G_STD, false),
      wind === 0 ? new ZeroWind() : new UniformWind(wind),
    ),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(dragCoefficient),
    }),
  );
}

function problem(target: PointTarget, dragCoefficient: number, wind = 0): ShootingProblem {
  const forces =
    dragCoefficient === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: context(dragCoefficient, wind),
    target,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/**
 * Turns a solve's `history` into the point sequence the plot draws: the
 * residual at the start of iteration 0, then the residual after each step.
 * `step.nextMerit` is the residual at the *next* iterate, so it is plotted at
 * `iteration + 1` — the same alignment `traceMeritPoints` uses in the UI.
 */
function traceOf(history: readonly { iteration: number; merit: number; nextMerit: number }[]) {
  const first = history[0]!;
  return [
    { iteration: first.iteration, merit: first.merit },
    ...history.map((step) => ({ iteration: step.iteration + 1, merit: step.nextMerit })),
  ];
}

describe("the quadratic tail of a real Newton shooting solve (P5.19 criterion)", () => {
  const V0 = 60;
  const THETA = 0.65;
  // R = v₀² sin 2θ / g, so this target is hit exactly by (THETA, V0).
  const RANGE = (V0 * V0 * Math.sin(2 * THETA)) / G_STD;

  it("doubles its log-residual slope per iteration near the root", () => {
    const residual = createShootingResidual(problem({ kind: "point", center: [RANGE, 0] }, 0));
    const result = newtonShooting(
      residual,
      { theta: 0.45, speed: V0 },
      { jacobian: { noiseFloor: NOISE_FLOOR } },
    );

    expect(result.converged).toBe(true);
    // ‖F‖: 6.616e+1 -> 3.042e+0 -> 5.472e-3 -> 1.782e-8, i.e. 1, 3, 5 and then
    // 8 correct decades — the doubling the plot is drawn to show.
    const ratio = finalMeritSlopeRatio(traceOf(result.history));

    // The window is 0.15 wide rather than exact because the asymptotic law is
    // `≈`, not `=`: the second-order term the derivation drops is still present
    // at these residuals, and each one is computed through an adaptive
    // integrator carrying its own error. Both bounds matter — the lower one
    // excludes the ≈ 1 of a linearly convergent method, the upper one excludes
    // a ratio that is large only because a slope underflowed.
    expect(ratio).toBeDefined();
    expect(ratio!).toBeGreaterThan(1.85);
    expect(ratio!).toBeLessThan(2.15);
  });

  it("still shows the tail with drag and wind, where no closed form exists", () => {
    const target: PointTarget = { kind: "point", center: [140, 0] };
    const residual = createShootingResidual(problem(target, 0.47, 5));
    const result = newtonShooting(
      residual,
      { theta: 0.5, speed: 55 },
      { jacobian: { noiseFloor: NOISE_FLOOR } },
    );

    expect(result.converged).toBe(true);

    const ratio = finalMeritSlopeRatio(traceOf(result.history));

    expect(ratio).toBeDefined();
    expect(ratio!).toBeGreaterThan(1.85);
    expect(ratio!).toBeLessThan(2.15);
  });

  /**
   * Worth a test of its own, because it is the first thing that will look like
   * a bug in the plot: the quadratic tail does not continue forever, and the
   * final segment can visibly flatten.
   *
   * A residual is only as accurate as the integrator that produced it. Asking
   * for `residualTolerance: 1e-10` buys one more Newton iteration past the
   * point where the trajectory solve can still resolve the miss distance, so
   * the last residual is limited by integrator noise rather than by Newton's
   * quadratic law, and the last-three-point ratio falls to ≈ 0.9. Nothing is
   * wrong with the solver or with the diagnostic; the sequence has simply left
   * the regime the law describes.
   */
  it("loses the doubling once the residual reaches the integrator's own accuracy", () => {
    const residual = createShootingResidual(problem({ kind: "point", center: [RANGE, 0] }, 0));
    const floorLimited = newtonShooting(
      residual,
      { theta: 0.45, speed: V0 },
      { jacobian: { noiseFloor: NOISE_FLOOR }, residualTolerance: 1e-10 },
    );

    expect(floorLimited.converged).toBe(true);
    // One more iteration than the default-tolerance solve above: 1.782e-8 ->
    // 2.275e-13, a gain of ~5 decades where doubling would have predicted ~11.
    const ratio = finalMeritSlopeRatio(traceOf(floorLimited.history));

    expect(ratio).toBeDefined();
    expect(ratio!).toBeLessThan(1.5);
  });
});
