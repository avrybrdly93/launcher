import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { TrajectoryRecorder, createDormandPrince54Stepper, integrate } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { PLANAR_LAYOUT, range as rangeObservable } from "./observables.js";
import {
  DRAG_FREE_PEAK_ANGLE,
  type RangeFunction,
  dragFreeRange,
  solveRangeRoot,
  solveRangeRoots,
} from "./range-root.js";

/**
 * P5.03's criterion is "recovers both analytic roots θ = ½asin(g R* / v₀²) and
 * complement to 1e-10", so every expected angle below is that closed form —
 * never a previous run of this code.
 *
 * The criterion is checked **twice, against two different range functions**,
 * and the second one is the point:
 *
 * 1. against {@link dragFreeRange}, the closed form `v₀² sin(2θ) / g`. This
 *    exercises the bracketing, the arc split and the stopping rule, but on its
 *    own it is thin: it asks a root finder to invert `sin`, and both the
 *    function and the expected answer come from the same three lines of
 *    algebra. A sign error shared between them would pass.
 * 2. against a **numerically integrated** trajectory — Dormand–Prince 5(4) with
 *    the model's ground-impact event, drag coefficient zero — read through the
 *    P5.01 `range` observable. Nothing in that path knows about `asin`. When
 *    the solver drives an integrated range to `R*` and the angle it lands on
 *    matches `½asin(g R* / v₀²)` to 1e-10, the closed form is an *independent*
 *    reference, which is what the criterion is actually asking for.
 */

/** The two analytic roots of `v₀² sin(2θ)/g = R*` for a drag-free ground launch. */
function analyticRoots(v0: number, targetRange: number): { low: number; high: number } {
  const low = 0.5 * Math.asin((G_STD * targetRange) / (v0 * v0));
  return { low, high: Math.PI / 2 - low };
}

/**
 * A {@link RangeFunction} that integrates a real drag-free launch at speed
 * `v0` and reads the range off the trajectory.
 *
 * The environment, params and model are built once and reused across every
 * angle the root finder asks for: each Brent iteration is a full integration,
 * and rebuilding the model per call would make this the slowest test in the
 * package for no benefit. `rtol`/`atol` are the tight values P5.01's
 * observables test uses, because a root converged to 1e-10 rad needs a range
 * whose own error is well below the range change that 1e-10 rad produces.
 */
function integratedRangeFn(v0: number): RangeFunction {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(G_STD, false),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()]);
  const stepper = createDormandPrince54Stepper();

  return (theta: number): number => {
    const y0 = new Float64Array([0, 0, v0 * Math.cos(theta), v0 * Math.sin(theta)]);
    const recorder = new TrajectoryRecorder();
    const report = integrate(
      model,
      ctx,
      y0,
      [0, 200],
      { stepper: stepper.info.id, h: 0.05, rtol: 1e-13, atol: 1e-14, maxSteps: 200_000 },
      stepper,
      [recorder],
    );
    expect(report.status).toBe("ok");
    return rangeObservable(recorder.trajectory, PLANAR_LAYOUT);
  };
}

describe("P5.03 solveRangeRoots against the drag-free closed form", () => {
  const CASES = [
    { name: "half of max range, v₀ = 50", v0: 50, targetRange: 127.4 },
    { name: "shallow ask, v₀ = 80", v0: 80, targetRange: 200 },
    { name: "near the envelope, v₀ = 30", v0: 30, targetRange: 91 },
    { name: "very short ask, v₀ = 120", v0: 120, targetRange: 50 },
  ] as const;

  for (const c of CASES) {
    describe(c.name, () => {
      const rangeFn: RangeFunction = (theta) => dragFreeRange(c.v0, theta);
      const result = solveRangeRoots(rangeFn, c.targetRange);
      const want = analyticRoots(c.v0, c.targetRange);

      it("reports the target reachable with both arcs", () => {
        expect(result.reachable).toBe(true);
        expect(result.low).not.toBeNull();
        expect(result.high).not.toBeNull();
        expect(result.shortfall).toBe(0);
      });

      it("recovers the low arc θ = ½asin(g R* / v₀²) to 1e-10", () => {
        expect(Math.abs(result.low!.theta - want.low)).toBeLessThan(1e-10);
      });

      it("recovers the high arc, the complement to π/2, to 1e-10", () => {
        expect(Math.abs(result.high!.theta - want.high)).toBeLessThan(1e-10);
      });

      it("reports max range v₀²/g at the peak", () => {
        expect(result.maxRange).toBeCloseTo((c.v0 * c.v0) / G_STD, 9);
        expect(result.peakAngle).toBe(DRAG_FREE_PEAK_ANGLE);
      });

      it("leaves a residual small relative to the target range", () => {
        expect(Math.abs(result.low!.residual)).toBeLessThan(1e-9 * c.targetRange);
        expect(Math.abs(result.high!.residual)).toBeLessThan(1e-9 * c.targetRange);
      });
    });
  }
});

describe("P5.03 solveRangeRoots against an integrated drag-free trajectory", () => {
  // One speed, two targets. Every Brent iteration here is a full adaptive
  // integration to ground impact, so this describe block is the expensive one
  // in the file; two cases is enough to show the closed form is an independent
  // reference and not enough to make the suite a timing problem.
  const V0 = 60;
  const rangeFn = integratedRangeFn(V0);

  for (const targetRange of [150, 320]) {
    describe(`R* = ${targetRange} m`, () => {
      const result = solveRangeRoots(rangeFn, targetRange);
      const want = analyticRoots(V0, targetRange);

      it("finds both arcs", () => {
        expect(result.low).not.toBeNull();
        expect(result.high).not.toBeNull();
      });

      it("lands on ½asin(g R* / v₀²) to 1e-10 without ever evaluating it", () => {
        expect(Math.abs(result.low!.theta - want.low)).toBeLessThan(1e-10);
      });

      it("lands on the complement to 1e-10", () => {
        expect(Math.abs(result.high!.theta - want.high)).toBeLessThan(1e-10);
      });

      it("the integrated range at each root really is R*", () => {
        expect(rangeFn(result.low!.theta)).toBeCloseTo(targetRange, 6);
        expect(rangeFn(result.high!.theta)).toBeCloseTo(targetRange, 6);
      });
    });
  }
});

describe("P5.03 reachability and degenerate targets", () => {
  const v0 = 40;
  const rangeFn: RangeFunction = (theta) => dragFreeRange(v0, theta);
  const maxRange = (v0 * v0) / G_STD;

  it("reports an out-of-reach target with its shortfall rather than throwing", () => {
    const result = solveRangeRoots(rangeFn, maxRange + 25);
    expect(result.reachable).toBe(false);
    expect(result.low).toBeNull();
    expect(result.high).toBeNull();
    expect(result.shortfall).toBeCloseTo(25, 9);
    expect(result.maxRange).toBeCloseTo(maxRange, 9);
  });

  it("collapses both arcs onto the peak when the target is exactly the max range", () => {
    const result = solveRangeRoots(rangeFn, rangeFn(DRAG_FREE_PEAK_ANGLE));
    expect(result.reachable).toBe(true);
    expect(result.low!.theta).toBe(DRAG_FREE_PEAK_ANGLE);
    expect(result.high!.theta).toBe(DRAG_FREE_PEAK_ANGLE);
  });

  it("returns θ = 0 for a zero target, and no high arc — because sin(π) is not 0 in binary", () => {
    // Worth pinning rather than hand-waving. `dragFreeRange` at π/2 evaluates
    // `sin(2 * Math.PI / 2)` = `sin(Math.PI)` = 1.2246e-16, not zero, so the
    // high branch runs from the peak down to a range of ~2e-14 m and never
    // attains 0. The low branch starts at `sin(0)` = exactly 0 and does. That
    // asymmetry is floating point, not physics, and a caller asking for a zero
    // range is outside the problem this module models — the case is here so
    // that the behaviour is recorded rather than discovered.
    const result = solveRangeRoots(rangeFn, 0);
    expect(result.low!.theta).toBe(0);
    expect(result.high).toBeNull();
    expect(rangeFn(Math.PI / 2)).toBeGreaterThan(0);
    expect(rangeFn(Math.PI / 2)).toBeLessThan(1e-13);
  });

  it("finds both arcs for a target just above that floating-point floor", () => {
    const result = solveRangeRoots(rangeFn, 1e-6);
    expect(result.low).not.toBeNull();
    expect(result.high).not.toBeNull();
    expect(result.low!.theta).toBeLessThan(1e-8);
    expect(Math.PI / 2 - result.high!.theta).toBeLessThan(1e-8);
  });

  it("finds no arc at all for a negative target", () => {
    const result = solveRangeRoots(rangeFn, -10);
    expect(result.reachable).toBe(true); // -10 m is "within reach" in the envelope sense…
    expect(result.low).toBeNull(); // …but no angle attains it, on either branch.
    expect(result.high).toBeNull();
  });
});

describe("P5.03 angle bounds", () => {
  const v0 = 50;
  const rangeFn: RangeFunction = (theta) => dragFreeRange(v0, theta);

  it("drops the low arc when a minimum elevation excludes it, and keeps the high arc", () => {
    // A launcher that cannot depress below 30° cannot fly the flat arc to a
    // target closer than its own 30° range — but the lofted arc still reaches.
    const minAngle = Math.PI / 6;
    const targetRange = dragFreeRange(v0, minAngle) - 20;
    const result = solveRangeRoots(rangeFn, targetRange, { minAngle });

    expect(result.reachable).toBe(true);
    expect(result.low).toBeNull();
    expect(result.high).not.toBeNull();
    expect(Math.abs(result.high!.theta - analyticRoots(v0, targetRange).high)).toBeLessThan(1e-10);
  });

  it("rejects a peak angle outside the bounds", () => {
    expect(() => solveRangeRoots(rangeFn, 100, { minAngle: 1.0 })).toThrow(/peakAngle/);
  });
});

describe("P5.03 solveRangeRoot on an explicit bracket", () => {
  const v0 = 45;
  const rangeFn: RangeFunction = (theta) => dragFreeRange(v0, theta);

  it("solves a single arc when handed the bracket directly", () => {
    const targetRange = 150;
    const root = solveRangeRoot(rangeFn, targetRange, 0, DRAG_FREE_PEAK_ANGLE);
    expect(Math.abs(root.theta - analyticRoots(v0, targetRange).low)).toBeLessThan(1e-10);
    expect(root.iterations).toBeGreaterThan(0);
  });

  it("throws rather than returning an endpoint when the bracket holds no root", () => {
    // 10 000 m is far beyond a 45 m/s launcher, so the residual is negative at
    // both ends of the low arc. Returning the nearer endpoint here would let a
    // caller read an unreachable target as a grazing solution.
    expect(() => solveRangeRoot(rangeFn, 10_000, 0, DRAG_FREE_PEAK_ANGLE)).toThrow(/bracket/);
  });
});

describe("P5.03 asymmetric range functions (why the arcs are bracketed, not reflected)", () => {
  // A drag-like range curve: still zero at both ends and single-peaked, but its
  // peak sits at atan(1/√2) ≈ 35.26°, below π/4, exactly as drag moves it.
  const skewed: RangeFunction = (theta) => Math.sin(theta) * Math.cos(theta) ** 2;
  const peakAngle = Math.atan(1 / Math.SQRT2);
  const targetRange = 0.3;

  const result = solveRangeRoots(skewed, targetRange, { peakAngle });

  it("finds both roots when told where the peak is", () => {
    expect(result.low).not.toBeNull();
    expect(result.high).not.toBeNull();
    expect(result.low!.theta).toBeLessThan(peakAngle);
    expect(result.high!.theta).toBeGreaterThan(peakAngle);
    expect(Math.abs(result.low!.residual)).toBeLessThan(1e-12);
    expect(Math.abs(result.high!.residual)).toBeLessThan(1e-12);
  });

  it("and reflecting the low root about the peak would NOT have been a root", () => {
    // This is the negative control for the design decision in
    // solveRangeRoots' doc comment. Reflection is exact for sin(2θ); here the
    // reflected angle misses by a wide margin, so a reflect-and-return
    // implementation would have shipped a wrong high arc the moment drag
    // entered — and every drag-free test above would still have passed.
    const reflected = 2 * peakAngle - result.low!.theta;
    expect(Math.abs(skewed(reflected) - targetRange)).toBeGreaterThan(1e-3);
  });
});
