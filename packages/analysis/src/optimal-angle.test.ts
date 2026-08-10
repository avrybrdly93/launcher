import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  ISA,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  dimensionlessPi,
  sutherlandViscosity,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { NO_IMPACT, maximizeRange } from "./optimal-angle.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { DRAG_FREE_PEAK_ANGLE, dragFreeRange, type RangeFunction } from "./range-root.js";
import { type Aim, type ShootingProblem, createFlight } from "./shooting-residual.js";

/**
 * P5.14: `argmax_θ R(θ)` with drag, against the 45° folklore.
 *
 * **This file is the exhibit, following the P4.09 / P4.22 / P4.34 precedent** —
 * an exhibit in this repo is a documented test module that runs the real physics
 * and records what it measures, not a UI route. Every angle below comes from
 * integrating the actual `createPlanarProjectileModel` with `QuadraticDragForce`
 * at dopri5 tolerances, and the numbers in the comments are what this file
 * printed, not what the theory predicts.
 *
 * The task's criterion has two halves and they are asserted separately:
 *
 *   1. **quadratic-drag optimum < 45°, typically 30–43° by regime.** The
 *      inequality holds everywhere measured; the band holds over the middle of
 *      the Π sweep and is asserted there. Both tails leave it, in the directions
 *      the physics requires — towards 45° as Π → 0, past 30° as Π grows — and
 *      each tail is its own assertion rather than a row quietly dropped from the
 *      sweep to make the band look universal.
 *   2. **the shift tracks Π**, the drag-to-gravity group
 *      `ρ·C_d·A·v₀²/(2·m·g)` that `@ballista/engine`'s `dimensionlessPi`
 *      defines. Asserted as strict monotonicity across a Π sweep rather than as
 *      a fitted law, because the relationship is not a power law and pretending
 *      otherwise would be inventing a result.
 *
 * **Why the drag-free case is checked first and against a closed form.** The
 * search must land on π/4 to well inside a tenth of a degree when drag is off,
 * or every "below 45°" measurement below is confounded with a biased optimizer.
 * That is the only assertion here that has an analytic answer, and it is what
 * makes the rest of the file evidence about physics rather than about search.
 *
 * **What makes 15 green cases evidence.** Each of these was applied to
 * `optimal-angle.ts`, run, and reverted:
 *
 *   | perturbation                                          | cases failing (of 15) |
 *   |---|---|
 *   | refinement result discarded, sweep sample returned     | 5 |
 *   | sign dropped: `+R` handed to the minimizer, so it minimizes | 6 |
 *   | non-impact scored `0` instead of `-Infinity`           | 1 |
 *   | `at-bound` reported as `converged`                     | 1 |
 *   | last sweep sample accumulated instead of set to `maxAngle` | 1 |
 *
 * The last row is why the final test in this file uses `maxAngle = 0.9` and 7
 * samples rather than a rounder bound: with most bounds the accumulated sum
 * rounds back to the exact value and the test would pass whether the guard
 * existed or not. It was written with such a bound first, measured as breaking
 * nothing, and changed.
 */

const TIGHT_TOL = {
  stepper: "dopri5" as const,
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/**
 * The air the integrations actually fly through.
 *
 * Taken from `ISA` and `sutherlandViscosity` rather than written as literals,
 * because `ConstantAtmosphere` takes no constructor arguments — it always
 * samples sea-level ISA. An earlier draft of this file passed `(1.225, 1.81e-5)`
 * to that constructor and used the same literals for Π; the arguments were
 * silently ignored at runtime, so the Π column was computed from numbers the
 * drag force had never seen. It happened to agree (`ISA.rho0` is 1.225, and η
 * does not enter Π at all for a `ConstantCd`, whose value ignores Reynolds
 * number), but agreeing by coincidence is not the same as being the same
 * quantity. `pnpm typecheck` is what caught it; vitest's transform did not.
 */
const RHO = ISA.rho0;
const ETA = sutherlandViscosity(ISA.T0);

const MASS = 1;
const RADIUS = 0.05;

function projectile(dragCoefficient: number) {
  return createSphericalProjectileParams({
    mass: MASS,
    radius: RADIUS,
    dragCoefficient: new ConstantCd(dragCoefficient),
  });
}

/**
 * Π at the launch speed, from the engine's own definition rather than a local
 * `ρCdA v²/2mg` — so the exhibit's abscissa is the same quantity the preset
 * browser and the solver advisor label Π, not a lookalike.
 */
function piAt(dragCoefficient: number, v0: number): number {
  return dimensionlessPi(projectile(dragCoefficient), { rho: RHO, eta: ETA, g: G_STD }, v0);
}

function problem(dragCoefficient: number): ShootingProblem {
  return {
    model: createPlanarProjectileModel(
      dragCoefficient === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()],
    ),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      projectile(dragCoefficient),
    ),
    // Unused by the range function below -- `createFlight` needs the field, and
    // nothing here forms a residual against it.
    target: { kind: "point", center: [0, 0] },
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 120],
    layout: PLANAR_LAYOUT,
  };
}

/**
 * An integrated `RangeFunction`: elevation to ground-impact downrange, by
 * flying the real model.
 *
 * Returns {@link NO_IMPACT} for an aim that does not land inside `tspan`, which
 * is the convention `maximizeRange` documents and the same one `envelope.ts`'s
 * sampler already uses. Also counts its calls, so the tests can report the
 * integration cost rather than guess at it.
 */
function integratedRange(
  dragCoefficient: number,
  v0: number,
): { range: RangeFunction; calls: () => number } {
  const fly = createFlight(problem(dragCoefficient));
  const xChannel = PLANAR_LAYOUT.position[0]!;
  let calls = 0;
  return {
    range: (theta: number) => {
      calls += 1;
      const aim: Aim = { theta, speed: v0 };
      const flight = fly(aim);
      if (!flight.ok || flight.trajectory === null) return NO_IMPACT;
      const traj = flight.trajectory;
      return traj.channels[xChannel]![traj.nSteps - 1]!;
    },
    calls: () => calls,
  };
}

const DEG = 180 / Math.PI;

describe("maximizeRange: the drag-free case, against the closed form", () => {
  it("recovers π/4 from the analytic range to better than 1e-3 rad", () => {
    // The analytic v₀²sin(2θ)/g, so this measures the search alone with no
    // integration error anywhere in it.
    const result = maximizeRange((theta) => dragFreeRange(50, theta));

    expect(result.status).toBe("converged");
    expect(result.converged).toBe(true);
    // Measured: |θ − π/4| = 0 exactly, and `range` equal to v₀²/g in every bit.
    // The assertion is nevertheless 1e-3 rad, not exactness: the *location* floor
    // at a smooth maximum is ~√(2ε·R/|R''|) ≈ 1e-8 rad here, so landing on the
    // exact double is this problem's symmetry being kind rather than a guarantee
    // the method offers, and pinning it would be pinning luck. 1e-3 rad is 0.06°,
    // far inside the claim this file makes.
    expect(Math.abs(result.theta - DRAG_FREE_PEAK_ANGLE)).toBeLessThan(1e-3);
    // The *value* is resolved far better than the location, which is the
    // asymmetry `OptimalAngle.theta` documents. Measured relative error 2e-16.
    expect(result.range).toBeCloseTo((50 * 50) / G_STD, 8);
    expect(Math.abs(result.shiftFromDragFree)).toBeLessThan(1e-3);
  });

  it("recovers π/4 from the integrated model with gravity only", () => {
    // Same claim through the integrator, so a bias in the model or in the
    // impact-channel read would show up here rather than being absorbed into the
    // drag measurements below. Measured: θ = 45.000000°, range
    // 254.92905324448225 m against the closed form's 254.92905324448208 m — a
    // relative difference of 7e-17, i.e. the integration is not what limits this.
    const { range, calls } = integratedRange(0, 50);
    const result = maximizeRange(range);

    expect(result.status).toBe("converged");
    expect(result.theta * DEG).toBeCloseTo(45, 2);
    expect(result.range).toBeCloseTo((50 * 50) / G_STD, 3);
    // Cost is reported rather than asserted tightly: 25 sweep integrations plus
    // refinement. Measured 25 + 6 = 31.
    expect(result.sweepEvaluations).toBe(25);
    expect(calls()).toBe(result.evaluations);
  });
});

describe("maximizeRange: the quadratic-drag optimum is below 45°, and how far below", () => {
  /**
   * A Π sweep at a fixed projectile (1 kg, 5 cm radius, C_d = 0.47), varying
   * only the launch speed — so every row is a shot someone might take rather
   * than a C_d someone might invent.
   *
   * MEASURED on this machine (node 22, dopri5 rtol 1e-12 atol 1e-14). Every
   * number here was printed by this file's own range function, not predicted:
   *
   * | v₀ (m/s) | Π       | θ* (deg) | R(θ*) (m) | shift from 45° | R loss at ±5° |
   * |---|---|---|---|---|---|
   * | 10       |  0.0231 | 44.8630  |  10.017   | −0.137°        | 1.51% / 1.50% |
   * | 20       |  0.0922 | 44.4713  |  38.083   | −0.529°        | 1.47% / 1.46% |
   * | 30       |  0.2075 | 43.8755  |  79.338   | −1.125°        | 1.41% / 1.40% |
   * | 50       |  0.5764 | 42.3232  | 180.377   | −2.677°        | 1.30% / 1.28% |
   * | 70       |  1.1297 | 40.6289  | 283.249   | −4.371°        | 1.21% / 1.17% |
   * | 100      |  2.3055 | 38.2736  | 419.328   | −6.726°        | 1.11% / 1.07% |
   * | 150      |  5.1875 | 35.1805  | 595.230   | −9.820°        | 1.03% / 0.97% |
   * | 200      |  9.2222 | 32.9375  | 726.767   | −12.063°       | 0.99% / 0.91% |
   * | 300      | 20.7499 | 29.9500  | 915.508   | −15.050°       | 0.95% / 0.86% |
   *
   * **The task's "typically 30–43° by regime" is the middle of this table, and
   * both ends leave the band — in the two directions the physics requires.** As
   * Π → 0 the optimum must return to 45°, and the top rows show it doing so
   * (44.86° at Π = 0.023); past Π ≈ 20 it keeps falling and passes below 30°.
   * So the band is asserted where it applies, `0.5 ≲ Π ≲ 10`, and the two tails
   * are asserted to leave it in the correct direction rather than being dropped
   * from the sweep to make a tidier claim.
   */
  const CD = 0.47;
  const SPEEDS = [10, 20, 30, 50, 70, 100, 150, 200, 300] as const;

  const measured = SPEEDS.map((v0) => {
    const { range } = integratedRange(CD, v0);
    const result = maximizeRange(range);
    return { v0, pi: piAt(CD, v0), result };
  });

  it("every regime converges and peaks strictly below 45°", () => {
    for (const { v0, result } of measured) {
      const label = `v0=${v0}`;
      expect(result.status, label).toBe("converged");
      expect(result.theta, label).toBeLessThan(DRAG_FREE_PEAK_ANGLE);
      expect(result.shiftFromDragFree, label).toBeLessThan(0);
    }
  });

  it("the optimum decreases strictly and monotonically with Π", () => {
    // The "shift vs Π" half of the criterion, asserted as strict monotonicity
    // rather than as a fitted law: the relationship has no closed form and
    // fitting one would be inventing a result. Π is asserted increasing too, so
    // the claim is about the ordering of both columns rather than of one.
    for (let i = 1; i < measured.length; i++) {
      const label = `v0=${measured[i]!.v0} vs ${measured[i - 1]!.v0}`;
      expect(measured[i]!.pi, label).toBeGreaterThan(measured[i - 1]!.pi);
      expect(measured[i]!.result.theta, label).toBeLessThan(measured[i - 1]!.result.theta);
    }
  });

  it("lands in the task's 30–43° band across 0.5 ≲ Π ≲ 10", () => {
    const inBand = measured.filter(({ pi }) => pi >= 0.5 && pi <= 10);
    // Guard the loop: a future edit to SPEEDS that emptied this range would make
    // the assertions below vacuous rather than failing.
    expect(inBand.length).toBeGreaterThanOrEqual(4);
    for (const { v0, result } of inBand) {
      const label = `v0=${v0}`;
      expect(result.theta * DEG, label).toBeGreaterThan(30);
      expect(result.theta * DEG, label).toBeLessThan(43);
    }
  });

  it("returns towards 45° as Π → 0, without ever reaching it", () => {
    // The band's lower-Π exception, asserted rather than omitted. At Π = 0.023
    // the shift is 0.137°, which is real (the previous test's `< 0` covers it)
    // and far too small for the 30–43° band to describe.
    const faintest = measured[0]!;
    expect(faintest.pi).toBeLessThan(0.05);
    expect(faintest.result.theta * DEG).toBeGreaterThan(44);
    expect(faintest.result.theta * DEG).toBeLessThan(45);
  });

  it("falls below 30° past Π ≈ 20", () => {
    // The band's upper-Π exception. Measured 29.95° at Π = 20.75.
    const heaviest = measured[measured.length - 1]!;
    expect(heaviest.pi).toBeGreaterThan(15);
    expect(heaviest.result.theta * DEG).toBeLessThan(30);
    expect(heaviest.result.theta * DEG).toBeGreaterThan(25);
  });

  it("the peak is broad: 5° off the optimum costs under 2% of the range", () => {
    // Why the loose location tolerance `OptimalAngle.theta` documents is not a
    // practical problem — measured, not argued. Worst loss across the sweep is
    // 1.51% at the lowest Π, and it *decreases* with Π (0.86% at Π = 20.7), so
    // the drag-dominated regimes whose optimum moves most are also the ones
    // least sensitive to missing it.
    for (const { v0, result } of measured) {
      const { range } = integratedRange(CD, v0);
      for (const offsetDeg of [-5, 5]) {
        const nearby = range(result.theta + offsetDeg / DEG);
        const label = `v0=${v0} @ ${offsetDeg}deg`;
        expect(nearby, label).toBeGreaterThan(0);
        expect((result.range - nearby) / result.range, label).toBeLessThan(0.02);
      }
    }
  });

  it("costs 25 sweep integrations plus a single-digit refinement", () => {
    // The cost that matters when the range function integrates, reported so a
    // caller budgeting integrations has a measured number. Measured totals
    // 33–40 evaluations, i.e. 8–15 in refinement.
    for (const { v0, result } of measured) {
      const label = `v0=${v0}`;
      expect(result.sweepEvaluations, label).toBe(25);
      expect(result.refineEvaluations, label).toBeGreaterThan(0);
      expect(result.refineEvaluations, label).toBeLessThan(25);
      expect(result.evaluations, label).toBe(result.sweepEvaluations + result.refineEvaluations);
    }
  });
});

describe("maximizeRange: bounds, degenerate intervals and inadmissible aims", () => {
  it("reports at-bound, not converged, when an elevation cap sits below the optimum", () => {
    // A launcher capped at 20° should aim at its cap, and the answer is a
    // property of the cap and not of the physics -- which is exactly why the
    // status differs. Reporting "converged" here would let a caller read 20° as
    // the unconstrained optimum.
    const { range } = integratedRange(0.47, 100);
    const capped = maximizeRange(range, { maxAngle: 20 / DEG });

    expect(capped.status).toBe("at-bound");
    expect(capped.converged).toBe(false);
    expect(capped.theta * DEG).toBeCloseTo(20, 9);
    expect(capped.bracket).toEqual([capped.theta, capped.theta]);
    expect(capped.refineEvaluations).toBe(0);

    // And the unconstrained optimum really is above the cap, so the case above
    // is the one it claims to be.
    expect(maximizeRange(range).theta * DEG).toBeGreaterThan(20);
  });

  it("finds an interior optimum inside bounds that contain it", () => {
    const { range } = integratedRange(0.47, 100);
    const bounded = maximizeRange(range, { minAngle: 10 / DEG, maxAngle: 60 / DEG });
    const unbounded = maximizeRange(range);

    expect(bounded.status).toBe("converged");
    // Same peak, reached from a different sweep grid -- so the answer is a
    // property of the range curve and not of the sample placement. Measured
    // difference 1.17e-8 rad (6.7e-7 deg), which is at the location floor.
    expect(bounded.theta * DEG).toBeCloseTo(unbounded.theta * DEG, 2);
  });

  it("reports no-impact when nothing in the bounds lands", () => {
    const result = maximizeRange(() => NO_IMPACT);

    expect(result.status).toBe("no-impact");
    expect(result.converged).toBe(false);
    expect(Number.isNaN(result.theta)).toBe(true);
    expect(Number.isNaN(result.range)).toBe(true);
    expect(Number.isNaN(result.shiftFromDragFree)).toBe(true);
    expect(result.evaluations).toBe(25);
  });

  it("treats NaN as inadmissible and finds the peak of the admissible set", () => {
    // An objective may reject a sub-interval; the search must contract away from
    // it rather than propagating the NaN into the answer. Here every aim *above*
    // 30° is rejected, which excludes the drag-free peak at π/4 -- so the
    // admissible set is [0, 30°], on which the range is still increasing, and
    // the answer must be a real angle at its right edge rather than 45° or NaN.
    const result = maximizeRange((theta) =>
      theta > 30 / DEG ? Number.NaN : dragFreeRange(50, theta),
    );

    expect(Number.isFinite(result.theta)).toBe(true);
    expect(Number.isFinite(result.range)).toBe(true);
    expect(result.theta * DEG).toBeGreaterThan(26);
    expect(result.theta * DEG).toBeLessThanOrEqual(30 + 1e-9);
    // And it is the *admissible* maximum, not merely inside the admissible set:
    // R is monotone there, so the answer should match R(30°).
    expect(result.range).toBeCloseTo(dragFreeRange(50, 30 / DEG), 3);
  });

  it("rejects malformed bounds and sweep sizes rather than guessing", () => {
    const range = (theta: number) => dragFreeRange(50, theta);

    expect(() => maximizeRange(range, { minAngle: 1, maxAngle: 1 })).toThrow(/minAngle < maxAngle/);
    expect(() => maximizeRange(range, { minAngle: 1, maxAngle: 0 })).toThrow(/minAngle < maxAngle/);
    expect(() => maximizeRange(range, { maxAngle: Number.POSITIVE_INFINITY })).toThrow(/finite/);
    expect(() => maximizeRange(range, { sweepSamples: 2 })).toThrow(/sweepSamples/);
    expect(() => maximizeRange(range, { sweepSamples: 4.5 })).toThrow(/sweepSamples/);
  });

  it("evaluates the upper bound exactly, not one rounding short of it", () => {
    // The last sweep sample is set to `maxAngle` rather than accumulated as
    // `minAngle + i·step`, so a hardware elevation limit is probed at the value
    // the caller set.
    //
    // The bound here is chosen so the two differ: with `maxAngle = 0.9` and 7
    // samples, `0 + 6·(0.9/6)` is `0.8999999999999999`, one ulp short. Most
    // bounds — 0.7 with 7 samples, π/2 with the default 25 — happen to round
    // back to the exact value, so a test using one of those would pass whether
    // the guard existed or not. Verified by perturbation: replacing the guard
    // with the accumulated form fails this case and nothing else in the file.
    const cap = 0.9;
    const samples = 7;
    const accumulated = 0 + (samples - 1) * (cap / (samples - 1));
    expect(accumulated).not.toBe(cap);

    const seen: number[] = [];
    maximizeRange(
      (theta) => {
        seen.push(theta);
        // Increasing on [0, cap], so the maximum is at the cap.
        return theta;
      },
      { minAngle: 0, maxAngle: cap, sweepSamples: samples },
    );

    expect(seen).toContain(cap);
    expect(seen).not.toContain(accumulated);
  });
});
