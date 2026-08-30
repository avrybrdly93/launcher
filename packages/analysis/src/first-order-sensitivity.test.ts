import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type EvalContext,
  G_STD,
  GravityForce,
  PCG32,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { type SolverConfig, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import {
  type UncertainOutputProblem,
  compareFirstOrderToMonteCarlo,
  firstOrderSpread,
  monteCarloSpread,
} from "./first-order-sensitivity.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { type Aim, type ShootingProblem, createFlight } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";
import {
  type TangentParameter,
  createTangentLinearFlight,
  rangeSensitivity,
} from "./tangent-linear.js";

/**
 * P6.17's criterion is "agreement within 10% for small σ; divergence shown for
 * large σ", and both halves are met here against a reference with no accuracy
 * of its own: the drag-free range
 *
 *   R(θ) = v₀² sin(2θ) / g,   ∂R/∂θ = 2 v₀² cos(2θ) / g,
 *
 * whose nonlinearity in θ is known in closed form rather than inferred. That
 * matters more than it usually would, because the thing under test is *when a
 * linear approximation stops holding* — a reference that is itself an
 * approximation cannot answer that.
 *
 * The suite is deliberately built on three response shapes:
 *
 * - **exactly linear**, where the delta method is not an approximation at all
 *   and any discrepancy is sampling noise. This is what pins down the common
 *   random numbers claim to floating point (see "the σ sweep is a pure
 *   rescaling" below) — under CRN a linear response's Monte Carlo spread must
 *   scale *exactly* with the input σ, and it does.
 * - **mildly curved** (30° elevation, small σ), where agreement inside 10% is
 *   asserted, and is in fact three orders better than the criterion asks.
 * - **badly curved** (large σ, and the 45° stationary point), where divergence
 *   is asserted *and shown to be resolvable* against the Monte Carlo estimator's
 *   own noise. An out-of-tolerance number from a small sample is not evidence
 *   of anything, which is why `significant` exists and why it is asserted
 *   rather than the raw discrepancy alone.
 *
 * The 45° case is the sharpest of the three and worth stating plainly: there
 * ∂R/∂θ is exactly zero, so the first-order estimate predicts **no output
 * spread at all** while the true spread is metres. The failure is not a
 * percentage, it is total, and no amount of shrinking σ fixes it — which is the
 * one thing a reader should take from this module before trusting a tornado
 * chart drawn from it.
 */

const V0 = 40;
const G = G_STD;

/** Drag-free range, the closed-form response every analytic case here uses. */
function analyticRange(theta: number): number {
  return ((V0 * V0) / G) * Math.sin(2 * theta);
}

/** Its exact derivative. */
function analyticRangeGradient(theta: number): number {
  return ((2 * V0 * V0) / G) * Math.cos(2 * theta);
}

/** The uncertain-θ problem at a given nominal elevation. */
function thetaProblem(theta0: number, sigma: number): UncertainOutputProblem {
  return {
    inputs: ["theta"],
    gradient: [analyticRangeGradient(theta0)],
    sigmas: [sigma],
    evaluate: (delta) => analyticRange(theta0 + delta[0]!),
  };
}

describe("firstOrderSpread", () => {
  it("propagates a single input as |dR/dmu| sigma", () => {
    const spread = firstOrderSpread([-3], [2]);
    expect(spread.sigma).toBeCloseTo(6, 12);
    expect(spread.contributions).toEqual([6]);
  });

  it("combines independent inputs in quadrature, not additively", () => {
    const spread = firstOrderSpread([3, 4], [1, 1]);
    expect(spread.contributions).toEqual([3, 4]);
    // 5, not 7 — the distinction the doc comment warns about.
    expect(spread.sigma).toBeCloseTo(5, 12);
  });

  it("gives a zero contribution to an input with no uncertainty", () => {
    const spread = firstOrderSpread([10, 10], [0.5, 0]);
    expect(spread.contributions).toEqual([5, 0]);
    expect(spread.sigma).toBeCloseTo(5, 12);
  });

  it("rejects a gradient and a sigma vector that index different inputs", () => {
    expect(() => firstOrderSpread([1, 2], [1])).toThrow(/same length/);
  });

  it("rejects a negative sigma rather than squaring the sign away", () => {
    expect(() => firstOrderSpread([1], [-1])).toThrow(/non-negative/);
  });

  it("rejects an empty problem", () => {
    expect(() => firstOrderSpread([], [])).toThrow(/no inputs/);
  });
});

describe("monteCarloSpread", () => {
  it("matches a hand-computed mean and Bessel-corrected sd", () => {
    const mc = monteCarloSpread([2, 4, 4, 4, 5, 5, 7, 9], 0);
    expect(mc.samples).toBe(8);
    expect(mc.mean).toBeCloseTo(5, 12);
    // Sum of squared deviations is 32; /(n-1) = 32/7.
    expect(mc.sigma).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(mc.meanShift).toBeCloseTo(5, 12);
  });

  it("counts a failed draw as censoring instead of dropping it silently", () => {
    const mc = monteCarloSpread([1, null, 3, null], 2);
    expect(mc.requested).toBe(4);
    expect(mc.samples).toBe(2);
    expect(mc.failures).toBe(2);
    expect(mc.censored).toBe(true);
  });

  it("is not censored when every draw lands", () => {
    expect(monteCarloSpread([1, 2, 3], 0).censored).toBe(false);
  });

  it("refuses to report a variance from fewer than two draws", () => {
    expect(() => monteCarloSpread([1, null], 0)).toThrow(/needs two/);
  });

  it("refuses a non-finite draw rather than propagating NaN into the moments", () => {
    expect(() => monteCarloSpread([1, 2, NaN], 0)).toThrow(/return null/);
  });

  it("reduces to the Gaussian standard error sigma/sqrt(2N) on a normal sample", () => {
    // The fourth-moment form is distribution-free; on a Gaussian sample it must
    // agree with the textbook formula, which is what makes it a generalisation
    // rather than a different quantity.
    const rng = new PCG32(7n);
    const n = 200_000;
    const values: number[] = [];
    for (let i = 0; i < n; i++) values.push(3 * rng.nextGaussian());
    const mc = monteCarloSpread(values, 0);
    expect(mc.sigma).toBeCloseTo(3, 1);
    expect(mc.standardError).toBeCloseTo(mc.sigma / Math.sqrt(2 * n), 4);
  });

  it("reports a zero standard error for a degenerate sample rather than NaN", () => {
    const mc = monteCarloSpread([4, 4, 4, 4], 4);
    expect(mc.sigma).toBe(0);
    expect(mc.standardError).toBe(0);
  });
});

describe("compareFirstOrderToMonteCarlo — the P6.17 criterion", () => {
  it("agrees within 10% for small sigma, and in fact far inside it", () => {
    const comparison = compareFirstOrderToMonteCarlo(thetaProblem(Math.PI / 6, 0.002), {
      samples: 4096,
      seed: 20260830n,
    });
    const [point] = comparison.points;
    expect(point).toBeDefined();
    expect(point!.monteCarlo.censored).toBe(false);
    expect(point!.withinTolerance).toBe(true);
    // The criterion is 10%; the response is near-linear over ±0.002 rad, so the
    // residual is sampling noise on the draws' own sample sd, not curvature.
    expect(Math.abs(point!.relativeError)).toBeLessThan(0.02);
  });

  it("diverges beyond 10% for large sigma, resolvably so", () => {
    const comparison = compareFirstOrderToMonteCarlo(thetaProblem(Math.PI / 6, 0.8), {
      samples: 4096,
      seed: 20260830n,
    });
    const [point] = comparison.points;
    expect(point!.withinTolerance).toBe(false);
    // Out of tolerance is not enough on its own: the discrepancy must exceed
    // the Monte Carlo sigma's own standard error by the significance margin,
    // or the finding is a small-sample artefact.
    expect(point!.significant).toBe(true);
    expect(point!.standardError).toBeGreaterThan(0);
    // sin(2θ) saturates towards its 45° maximum, so the true spread is smaller
    // than a linear extrapolation of the slope at 30° predicts: the first-order
    // estimate *overstates* it.
    expect(point!.relativeError).toBeGreaterThan(0.1);
  });

  it("stays inside tolerance where the criterion's 'small sigma' actually is", () => {
    // Worth pinning because the discrepancy is *not* monotone in σ on this
    // response: it dips negative (the truth spreads more than the slope says)
    // before turning positive and running away. A test that only sampled the
    // extremes could read the crossing as agreement. σ ≈ 0.3 rad is the dip,
    // and even there the criterion holds with room to spare.
    for (const sigma of [0.2, 0.3, 0.4]) {
      const point = compareFirstOrderToMonteCarlo(thetaProblem(Math.PI / 6, sigma), {
        samples: 4096,
        seed: 20260830n,
      }).points[0]!;
      expect(point.relativeError).toBeLessThan(0);
      expect(point.withinTolerance).toBe(true);
    }
  });

  it("shows the whole sweep crossing from agreement into divergence", () => {
    const comparison = compareFirstOrderToMonteCarlo(thetaProblem(Math.PI / 6, 0.08), {
      scales: [0.01, 0.1, 1, 10],
      samples: 2048,
      seed: 20260830n,
    });
    expect(comparison.points).toHaveLength(4);
    expect(comparison.points[0]!.withinTolerance).toBe(true);
    expect(comparison.points[1]!.withinTolerance).toBe(true);
    expect(comparison.points[2]!.withinTolerance).toBe(true);
    expect(comparison.points[3]!.withinTolerance).toBe(false);
    expect(comparison.points[3]!.significant).toBe(true);

    // The small-σ points do not tend to zero error, and that is not a defect:
    // under common random numbers they share one draw matrix whose own sample
    // sd differs from 1 by O(1/sqrt(2N)), and that offset is *identical* at
    // every scale. What the sweep shows is curvature emerging on top of that
    // floor, so the claim to assert is that the largest scale beats every
    // smaller one — not a monotone march from zero.
    const errors = comparison.points.map((p) => Math.abs(p.relativeError));
    const last = errors[errors.length - 1]!;
    for (const error of errors.slice(0, -1)) expect(last).toBeGreaterThan(error);
    expect(errors[0]).toBeCloseTo(errors[1]!, 3);
  });

  it("predicts no spread at all at the stationary point, where the truth is metres", () => {
    // θ = 45° maximises the drag-free range, so ∂R/∂θ is exactly zero and the
    // first-order estimate is not merely inaccurate — it is structurally blind.
    const comparison = compareFirstOrderToMonteCarlo(thetaProblem(Math.PI / 4, 0.1), {
      samples: 4096,
      seed: 20260830n,
    });
    expect(comparison.gradient[0]).toBeCloseTo(0, 12);
    expect(comparison.firstOrder.sigma).toBeCloseTo(0, 12);
    const [point] = comparison.points;
    expect(point!.firstOrder).toBeCloseTo(0, 12);
    expect(point!.monteCarlo.sigma).toBeGreaterThan(0.5);
    expect(point!.relativeError).toBeCloseTo(-1, 6);
    expect(point!.withinTolerance).toBe(false);
    expect(point!.significant).toBe(true);
  });

  it("surfaces curvature in the mean before the variance discrepancy bites", () => {
    // First order predicts meanShift = 0 for any sigma. At 45° the response is
    // locally concave, so the Monte Carlo mean must fall *below* the nominal —
    // and by many standard errors of the mean, or it is not a finding.
    const comparison = compareFirstOrderToMonteCarlo(thetaProblem(Math.PI / 4, 0.15), {
      samples: 4096,
      seed: 20260830n,
    });
    const mc = comparison.points[0]!.monteCarlo;
    expect(comparison.nominal).toBeCloseTo(analyticRange(Math.PI / 4), 12);
    expect(mc.meanShift).toBeLessThan(0);
    const standardErrorOfMean = mc.sigma / Math.sqrt(mc.samples);
    expect(Math.abs(mc.meanShift)).toBeGreaterThan(10 * standardErrorOfMean);
  });
});

describe("compareFirstOrderToMonteCarlo — common random numbers", () => {
  it("makes the sigma sweep an exact rescaling when the response is linear", () => {
    // The sharpest available check on the CRN claim. With R linear, every draw's
    // output is exactly proportional to the scale, so the sample sd is too — to
    // floating point, not to sampling error. Independent draws per scale would
    // put a percent-level wobble here.
    const linear: UncertainOutputProblem = {
      inputs: ["a", "b"],
      gradient: [2, -5],
      sigmas: [0.3, 0.7],
      evaluate: (delta) => 11 + 2 * delta[0]! - 5 * delta[1]!,
    };
    const comparison = compareFirstOrderToMonteCarlo(linear, {
      scales: [1, 4, 16],
      samples: 512,
      seed: 5n,
    });
    const [one, four, sixteen] = comparison.points;
    expect(four!.monteCarlo.sigma / one!.monteCarlo.sigma).toBeCloseTo(4, 10);
    expect(sixteen!.monteCarlo.sigma / one!.monteCarlo.sigma).toBeCloseTo(16, 10);
    // And the delta method is exact for a linear response, so the residual is
    // only the draws' own sample sd departing from 1 — identical at every scale.
    for (const point of comparison.points) {
      expect(point!.relativeError).toBeCloseTo(one!.relativeError, 10);
      expect(point!.withinTolerance).toBe(true);
    }
  });

  it("reproduces a study exactly from its seed, and moves when the seed moves", () => {
    const problem = thetaProblem(Math.PI / 6, 0.05);
    const a = compareFirstOrderToMonteCarlo(problem, { samples: 512, seed: 42n });
    const b = compareFirstOrderToMonteCarlo(problem, { samples: 512, seed: 42n });
    const c = compareFirstOrderToMonteCarlo(problem, { samples: 512, seed: 43n });
    expect(b.points[0]!.monteCarlo.sigma).toBe(a.points[0]!.monteCarlo.sigma);
    expect(b.points[0]!.monteCarlo.mean).toBe(a.points[0]!.monteCarlo.mean);
    expect(c.points[0]!.monteCarlo.sigma).not.toBe(a.points[0]!.monteCarlo.sigma);
    // Different draws, same underlying answer: the two seeds agree within noise.
    expect(c.points[0]!.monteCarlo.sigma).toBeCloseTo(a.points[0]!.monteCarlo.sigma, 1);
  });
});

describe("compareFirstOrderToMonteCarlo — refusals", () => {
  const problem = thetaProblem(Math.PI / 6, 0.01);

  it("rejects a problem whose arrays index different inputs", () => {
    expect(() => compareFirstOrderToMonteCarlo({ ...problem, inputs: ["theta", "speed"] })).toThrow(
      /index the same inputs/,
    );
  });

  it("rejects a non-positive scale", () => {
    expect(() => compareFirstOrderToMonteCarlo(problem, { scales: [0] })).toThrow(/positive/);
    expect(() => compareFirstOrderToMonteCarlo(problem, { scales: [] })).toThrow(/no scales/);
  });

  it("rejects a sample count that cannot form a variance", () => {
    expect(() => compareFirstOrderToMonteCarlo(problem, { samples: 1 })).toThrow(/at least 2/);
  });

  it("rejects a nominal point that does not exist", () => {
    expect(() => compareFirstOrderToMonteCarlo({ ...problem, evaluate: () => null })).toThrow(
      /nominal point/,
    );
  });

  it("reports censoring rather than hiding draws that fall off the problem", () => {
    let call = 0;
    const censoring: UncertainOutputProblem = {
      ...problem,
      evaluate: (delta) => {
        call++;
        // Let the nominal through, then fail every third draw.
        return call > 1 && call % 3 === 0 ? null : analyticRange(Math.PI / 6 + delta[0]!);
      },
    };
    const comparison = compareFirstOrderToMonteCarlo(censoring, { samples: 90, seed: 3n });
    const mc = comparison.points[0]!.monteCarlo;
    expect(mc.censored).toBe(true);
    expect(mc.failures).toBeGreaterThan(0);
    expect(mc.samples + mc.failures).toBe(90);
  });
});

/**
 * The engine-backed case: the same comparison run through the real integrator
 * and the real tangent-linear gradient, on the parameter §7's uncertainty
 * discussion actually names — "how a 1% uncertainty in C_d maps to a range
 * dispersion".
 *
 * This is the one test here whose gradient is computed rather than known, so it
 * is also the one that checks the seam: `rangeSensitivity` feeds
 * `firstOrderSpread`, and the Monte Carlo side re-solves the trajectory at
 * displaced C_d with no reference to the gradient at all. If either half read
 * the wrong parameter or the wrong channel, the two would not agree.
 */
describe("compareFirstOrderToMonteCarlo — against the integrated flight", () => {
  const CD0 = 0.47;
  const AIM: Aim = { theta: Math.PI / 5, speed: V0 };
  const TARGET: PointTarget = { kind: "point", center: [10, 0] };
  const CONFIG: SolverConfig = { stepper: "dopri5", rtol: 1e-10, atol: 1e-12, maxSteps: 200_000 };

  function context(cd: number): EvalContext {
    return createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(cd),
      }),
    );
  }

  function problemAt(cd: number): ShootingProblem {
    return {
      model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
      ctx: context(cd),
      target: TARGET,
      launchPoint: [0, 0],
      config: CONFIG,
      stepper: createDormandPrince54Stepper(),
      tspan: [0, 600],
      layout: PLANAR_LAYOUT,
    };
  }

  /** Downrange distance at impact, by integration. */
  function range(cd: number): number | null {
    const flight = createFlight(problemAt(cd))(AIM);
    if (!flight.ok || flight.trajectory === null) return null;
    return flight.trajectory.channels[0]![flight.trajectory.nSteps - 1]!;
  }

  const dragParameter: TangentParameter = {
    name: "cd",
    displaceContext: (delta) => context(CD0 + delta),
    scale: CD0,
  };

  it("agrees within 10% on a 2% drag-coefficient uncertainty", () => {
    const flight = createTangentLinearFlight(problemAt(CD0), [dragParameter])(AIM);
    expect(flight.ok).toBe(true);
    const gradient = rangeSensitivity(flight);
    expect(gradient).not.toBeNull();
    // More drag, less range: the sign is physics, and a sign error here would
    // still square away inside the spread formula.
    expect(gradient![0]!).toBeLessThan(0);

    const sigma = 0.02 * CD0;
    const comparison = compareFirstOrderToMonteCarlo(
      {
        inputs: ["cd"],
        gradient: gradient!,
        sigmas: [sigma],
        evaluate: (delta) => range(CD0 + delta[0]!),
      },
      { samples: 256, seed: 11n },
    );

    const point = comparison.points[0]!;
    expect(point.monteCarlo.censored).toBe(false);
    expect(point.monteCarlo.sigma).toBeGreaterThan(0);
    expect(point.withinTolerance).toBe(true);
    // The nominal range is metres and the dispersion is centimetres-to-metres;
    // assert the spread is a real, non-degenerate quantity rather than noise.
    expect(comparison.firstOrder.sigma).toBeGreaterThan(1e-3);
  });
});
