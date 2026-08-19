import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { solveArcs } from "./arcs.js";
import { goldenRatioSamples, multiStart, multiStartAngles } from "./multi-start.js";
import { newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.27's criterion is "finds both arcs without user hint", and the substantive
 * half of this file is the pair of measurements that say what "without a hint"
 * had to mean before the module could satisfy it.
 *
 * The first is a **negative control on the unconstrained problem** — the reason
 * the speed is held fixed at all. A multi-start over `(θ, v₀)` does not have a
 * deduplication problem to solve, because it does not have isolated solutions:
 * `describe("why the speed is pinned")` runs 21 starts and gets 21 distinct
 * converged aims, all of them correct. Any dedup applied there returns 21, and
 * "both arcs" is not a statement about that set.
 *
 * The second is the criterion itself: at a fixed speed the same scatter of
 * starts collapses onto exactly two elevations, they carry opposite `∂R/∂θ`
 * signs, and they agree with P5.08's `solveArcs` — which found them the other
 * way, by locating the peak and bracketing either side of it. Agreement between
 * a method that uses the hint and one that does not is what makes the second
 * one's answer trustworthy rather than lucky.
 */

const TOL = {
  stepper: "dopri5" as const,
  rtol: 1e-11,
  atol: 1e-13,
  maxSteps: 200_000,
};

/** The drag coefficient of a smooth sphere, the scenario library's default. */
const DRAG_COEFFICIENT = 0.47;
/** The speed every fixed-speed run in this file uses, m/s. */
const SPEED = 55;
/** A target comfortably inside the envelope at {@link SPEED}, metres. */
const TARGET_DOWNRANGE = 140;

function problem(target: PointTarget): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(DRAG_COEFFICIENT),
      }),
    ),
    target,
    config: TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

function pointTarget(downrange: number): PointTarget {
  return { kind: "point", center: [downrange, 0] };
}

/** Gaps between consecutive points of a unit-interval sample set, wrapping. */
function gapsOf(samples: readonly number[]): number[] {
  const sorted = [...samples].sort((a, b) => a - b);
  const gaps = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i]! - sorted[i - 1]!);
  gaps.push(1 - sorted[sorted.length - 1]!);
  return gaps;
}

describe("goldenRatioSamples", () => {
  it("is deterministic, so two runs of a solve get byte-identical starts", () => {
    expect(goldenRatioSamples(12)).toEqual(goldenRatioSamples(12));
  });

  it("lies inside the unit interval and never on its lower edge", () => {
    for (const x of goldenRatioSamples(64)) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("extends rather than resamples: the first n of n+k are the first n", () => {
    // A caller raising startCount keeps every start it already paid for. A
    // uniform grid has no such property -- refining it moves every sample.
    expect(goldenRatioSamples(20).slice(0, 8)).toEqual(goldenRatioSamples(8));
  });

  it("leaves gaps of exactly three lengths — the three-distance theorem, measured", () => {
    // The property the sequence is chosen for. At every count the gaps take at
    // most three distinct values, so the point set never develops a void as it
    // grows: each new point splits one of the largest gaps.
    const gaps = gapsOf(goldenRatioSamples(16));
    const distinct = new Set(gaps.map((gap) => gap.toFixed(12)));
    expect(distinct.size).toBe(3);
    expect([...distinct].sort()).toEqual(["0.034441853749", "0.055728090001", "0.090169943749"]);
  });

  it("does NOT beat a uniform grid on largest gap at a fixed count, and the claim is pinned", () => {
    // Stated as an assertion because it is the argument someone will reach for
    // and it is false: at n = 16 this sequence's largest gap is 0.0902 against
    // a grid's 0.0625. The sequence earns its place on the two properties
    // above and below -- three gap lengths, and prefix extension -- not on
    // this one. Pinned so the wrong reason cannot quietly come back.
    expect(Math.max(...gapsOf(goldenRatioSamples(16)))).toBeGreaterThan(1 / 16);
  });

  it("rejects a count that is not a positive integer", () => {
    expect(() => goldenRatioSamples(0)).toThrow(/positive integer/);
    expect(() => goldenRatioSamples(2.5)).toThrow(/positive integer/);
  });
});

describe("multiStartAngles", () => {
  it("returns the requested count, ascending, strictly inside the bounds", () => {
    const angles = multiStartAngles(0.1, 1.4, 16);
    expect(angles).toHaveLength(16);
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]!).toBeGreaterThan(angles[i - 1]!);
    }
    expect(angles[0]!).toBeGreaterThan(0.1);
    expect(angles[angles.length - 1]!).toBeLessThan(1.4);
  });

  it("rejects a degenerate or inverted interval", () => {
    expect(() => multiStartAngles(1.0, 1.0, 4)).toThrow(/maxAngle must exceed minAngle/);
    expect(() => multiStartAngles(1.2, 0.3, 4)).toThrow(/maxAngle must exceed minAngle/);
    expect(() => multiStartAngles(Number.NaN, 1.0, 4)).toThrow(/bounds must be finite/);
  });
});

describe("why the speed is pinned", () => {
  it("finds 21 distinct solutions from 21 starts when the speed is free — so dedup is not the question there", () => {
    // The negative control. A ground-impact residual is one scalar equation in
    // two unknowns (P5.05's zero vertical Jacobian row), so its solution set is
    // a curve and the minimum-norm Newton step lands on whichever point of that
    // curve is nearest the start. Every one of these is a correct answer, and
    // no deduplication rule that respects them can return two.
    const residual = createShootingResidual(problem(pointTarget(TARGET_DOWNRANGE)));
    const solutions: Aim[] = [];
    for (const theta of [0.15, 0.35, 0.55, 0.75, 0.95, 1.15, 1.35]) {
      for (const speed of [40, 55, 70]) {
        const result = newtonShooting(residual, { theta, speed }, { residualTolerance: 1e-9 });
        expect(result.residual.ok).toBe(true);
        // Every one of them really is a hit, to well under a nanometre.
        expect(Math.abs(result.residual.residual![0]!)).toBeLessThan(1e-9);
        solutions.push(result.aim);
      }
    }
    expect(solutions).toHaveLength(21);

    // Distinct under the same 1e-6 rad merge tolerance multiStart defaults to.
    const distinct: Aim[] = [];
    for (const candidate of solutions) {
      const seen = distinct.some(
        (other) =>
          Math.abs(other.theta - candidate.theta) <= 1e-6 &&
          Math.abs(other.speed - candidate.speed) <= 1e-6,
      );
      if (!seen) distinct.push(candidate);
    }
    expect(distinct).toHaveLength(21);

    // And they are spread along a curve, not scattered: the speeds span a wide
    // band, which is exactly the null direction the solver declines to move in.
    const speeds = solutions.map((aim) => aim.speed);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(20);
  });
});

describe("multiStart: P5.27 validation — finds both arcs without user hint", () => {
  const residual = createShootingResidual(problem(pointTarget(TARGET_DOWNRANGE)));
  const result = multiStart(residual, SPEED, { minAngle: 0.05, maxAngle: 1.5, startCount: 16 });

  it("collapses 16 starts onto exactly two distinct solutions", () => {
    expect(result.attempts).toHaveLength(16);
    expect(result.solutions).toHaveLength(2);
    // 15 of 16, not 16 of 16 -- see the basin-boundary test below, which is
    // where the sixteenth went and why that is the right answer.
    expect(result.accepted).toBe(15);
    // Every accepted start is accounted for by one cluster or another.
    const clustered = result.solutions.reduce((sum, s) => sum + s.starts, 0);
    expect(clustered).toBe(result.accepted);
    expect(result.solutions.map((s) => s.starts)).toEqual([7, 8]);
  });

  it("loses exactly the one start that lands on the basin boundary, and no other", () => {
    // The single rejected start is θ = 0.734597, and solveArcs measures the
    // maximum-range elevation at 0.731303 -- 3.3 mrad away. ∂R/∂θ is passing
    // through zero there, so the projected minimum-norm step is itself near
    // zero and the iteration stops on its step tolerance after ONE iteration
    // with a 66 m miss still outstanding. That is not a solver failure: it is
    // P5.20's basin boundary, which has to be somewhere, sampled. Rejecting it
    // is correct -- the peak belongs to neither arc -- and it is asserted here
    // rather than tolerated silently, so a change that starts accepting it, or
    // that loses a second start, fails.
    const rejected = result.attempts.filter((attempt) => !attempt.accepted);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.start).toBeCloseTo(0.7345971, 6);
    expect(rejected[0]!.iterations).toBe(1);
    expect(Math.abs(rejected[0]!.downrangeMiss!)).toBeGreaterThan(1);

    const arcs = solveArcs(problem(pointTarget(TARGET_DOWNRANGE)), SPEED);
    expect(Math.abs(rejected[0]!.start - arcs.peakAngle)).toBeLessThan(5e-3);
    // Every start further than that from the peak was accepted.
    for (const attempt of result.attempts) {
      if (attempt.accepted) expect(Math.abs(attempt.start - arcs.peakAngle)).toBeGreaterThan(5e-3);
    }
  });

  it("labels one low and one high, from the sign of ∂R/∂θ alone", () => {
    const [low, high] = result.solutions;
    expect(low!.branch).toBe("low");
    expect(high!.branch).toBe("high");
    // The labels are a measured derivative, not the ordering: assert the signs
    // directly so a swap could not pass by agreeing with the sort.
    expect(low!.rangeSlope!).toBeGreaterThan(0);
    expect(high!.rangeSlope!).toBeLessThan(0);
  });

  it("agrees with solveArcs, which found the same two arcs the other way", () => {
    // solveArcs uses the hint: it locates the maximum-range elevation with a
    // sweep and brackets either side of it. Agreement between the method that
    // knows where to look and the one that does not is what makes this answer
    // trustworthy rather than lucky.
    const arcs = solveArcs(problem(pointTarget(TARGET_DOWNRANGE)), SPEED);
    expect(arcs.reachable).toBe(true);
    expect(result.solutions[0]!.aim.theta).toBeCloseTo(arcs.low!.aim.theta, 6);
    expect(result.solutions[1]!.aim.theta).toBeCloseTo(arcs.high!.aim.theta, 6);
  });

  it("holds the speed exactly, on every attempt and every solution", () => {
    for (const attempt of result.attempts) expect(attempt.aim!.speed).toBe(SPEED);
    for (const solution of result.solutions) expect(solution.aim.speed).toBe(SPEED);
    expect(result.speed).toBe(SPEED);
  });

  it("hits the target from both solutions", () => {
    for (const solution of result.solutions) {
      expect(Math.abs(solution.downrangeMiss)).toBeLessThan(1e-3);
    }
  });

  it("leaves the merge tolerance two orders of room below and nearly six above", () => {
    // The number that decides the count, checked rather than trusted, and the
    // margins are asymmetric in a way worth stating rather than rounding to
    // "plenty". BELOW: the widest disagreement within a cluster is 6.1e-9 rad,
    // about 160x tighter than the 1e-6 default -- set by where the projected
    // solve stops, not by the residual tolerance, since the step goes to zero
    // on the flat part of the merit function before ‖F‖ does. Two orders is
    // real room but it is not five, and a caller tightening mergeTolerance
    // past ~1e-8 would start splitting one solution into several.
    // ABOVE: the two arcs sit 0.88 rad apart, some 880 000x the tolerance.
    for (const solution of result.solutions) {
      expect(solution.spread).toBeLessThan(1e-8);
      expect(solution.spread).toBeGreaterThan(1e-10);
    }
    expect(result.minimumSeparation).toBeGreaterThan(0.8);
  });

  it("spends its evaluations on the solve, and reports how many", () => {
    expect(result.evaluations).toBeGreaterThan(16);
    expect(Number.isFinite(result.evaluations)).toBe(true);
  });
});

describe("multiStart: what it does when there are not two arcs", () => {
  it("finds nothing, rather than something, for a target past the envelope", () => {
    // At 55 m/s this scenario's envelope is around 190 m. Nothing reaches 400 m,
    // and the honest answer is an empty solution set with every attempt
    // recorded -- not a nearest-miss dressed up as a solution.
    const residual = createShootingResidual(problem(pointTarget(400)));
    const result = multiStart(residual, SPEED, { startCount: 8 });
    expect(result.attempts).toHaveLength(8);
    expect(result.accepted).toBe(0);
    expect(result.solutions).toHaveLength(0);
    expect(result.minimumSeparation).toBe(Number.POSITIVE_INFINITY);
    // Every attempt still carries the miss it achieved, so a caller can see how
    // far out of reach the target was rather than only that it was.
    for (const attempt of result.attempts) {
      expect(attempt.accepted).toBe(false);
      expect(attempt.downrangeMiss).not.toBeNull();
      expect(attempt.downrangeMiss!).toBeLessThan(0); // short, all of them
    }
  });

  it("reports one solution when the angle bounds exclude an arc", () => {
    // A launcher that cannot elevate past 40 degrees has no lofted arc to this
    // target. One solution is the correct answer, and it must still be labelled
    // from its own derivative rather than inferred from being alone.
    const residual = createShootingResidual(problem(pointTarget(TARGET_DOWNRANGE)));
    const result = multiStart(residual, SPEED, {
      minAngle: 0.05,
      maxAngle: 40 * (Math.PI / 180),
      startCount: 12,
    });
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]!.branch).toBe("low");
    expect(result.minimumSeparation).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("multiStart: explicit starts and input guards", () => {
  it("honours caller-supplied starts, sorted, in place of the sequence", () => {
    const residual = createShootingResidual(problem(pointTarget(TARGET_DOWNRANGE)));
    const result = multiStart(residual, SPEED, { starts: [1.2, 0.2, 0.9] });
    expect(result.attempts.map((a) => a.start)).toEqual([0.2, 0.9, 1.2]);
  });

  it("rejects a speed, tolerance or step that cannot mean anything", () => {
    const residual = createShootingResidual(problem(pointTarget(TARGET_DOWNRANGE)));
    expect(() => multiStart(residual, 0)).toThrow(/speed must be finite and positive/);
    expect(() => multiStart(residual, Number.NaN)).toThrow(/speed must be finite and positive/);
    expect(() => multiStart(residual, SPEED, { downrangeTolerance: 0 })).toThrow(
      /downrangeTolerance must be finite and positive/,
    );
    expect(() => multiStart(residual, SPEED, { mergeTolerance: -1 })).toThrow(
      /mergeTolerance must be finite and positive/,
    );
    expect(() => multiStart(residual, SPEED, { slopeStep: Number.POSITIVE_INFINITY })).toThrow(
      /slopeStep must be finite and positive/,
    );
    expect(() => multiStart(residual, SPEED, { starts: [] })).toThrow(
      /at least one starting elevation/,
    );
  });
});
