import { describe, expect, it } from "vitest";
import {
  MAX_SOBOL_INDEX_INPUTS,
  type SobolIndex,
  type SobolIndexProblem,
  sobolIndices,
} from "./sobol-indices.js";

/**
 * P6.19's criterion is "indices on an additive test function match analytics
 * ±0.05", and it is met here against references that have no accuracy of
 * their own — the same standard `tornado.test.ts` holds itself to, and for the
 * same reason. A Sobol' index is a ratio of variances, so a reference whose
 * indices are themselves estimated could not distinguish an estimator error
 * from the reference's.
 *
 * Two references carry the suite, and the split between them is the point of
 * the module:
 *
 * - **The additive reference** `f(x) = Σ a_k x_k` with `x_k ~ U(0,1)` is the
 *   criterion's own function. The terms are independent, so
 *   `V = Σ a_k²/12` and `V_k = a_k²/12` exactly, giving
 *   `S_k = S_T_k = a_k² / Σ a_j²` with no interaction at all. Every structural
 *   claim the module makes — `S_k ≤ S_T_k`, `Σ S_k ≤ 1`, `Σ S_T_k ≥ 1`, all
 *   three tight only for an additive model — is an *equality* here, so this
 *   function tests the estimator and the identities at once.
 * - **The Ishigami function** is the conventional non-additive reference and
 *   also has closed-form indices. It is here because the additive case cannot
 *   fail the way this module exists to catch: an estimator that ignored
 *   interactions entirely would pass every additive assertion above.
 *   Ishigami's third input has `S_3 = 0` and `S_T_3 ≈ 0.24` — it influences
 *   the output *only* through its interaction with the first — which is
 *   precisely the input a tornado chart reports as irrelevant. That case is
 *   asserted, not described.
 *
 * Sample sizes are fixed and the seeds are fixed, so every tolerance below is
 * a statement about a deterministic number rather than a hope about a random
 * one.
 */

/** `f(x) = Σ a_k x_k` on the unit cube, with the coefficients used throughout. */
const ADDITIVE_COEFFICIENTS = [4, 2, 1] as const;

function additiveProblem(coefficients: readonly number[], offset = 0): SobolIndexProblem {
  return {
    inputs: coefficients.map((_, k) => `x${k}`),
    evaluate(u) {
      let y = offset;
      for (let k = 0; k < coefficients.length; k++) y += coefficients[k]! * u[k]!;
      return y;
    },
  };
}

/** `S_k = S_T_k = a_k² / Σ a_j²`, exactly, for the additive reference. */
function additiveAnalytics(coefficients: readonly number[]): number[] {
  const squares = coefficients.map((a) => a * a);
  const total = squares.reduce((s, v) => s + v, 0);
  return squares.map((s) => s / total);
}

const ISHIGAMI_A = 7;
const ISHIGAMI_B = 0.1;

/**
 * `f = sin x₁ + a sin² x₂ + b x₃⁴ sin x₁`, with each `xᵢ ~ U(−π, π)`.
 *
 * The uniforms arrive on `(0, 1)`, so the quantile is `−π + 2π u` — folded in
 * here, per the module's one-callback contract.
 */
const ishigamiProblem: SobolIndexProblem = {
  inputs: ["x1", "x2", "x3"],
  evaluate(u) {
    const x1 = -Math.PI + 2 * Math.PI * u[0]!;
    const x2 = -Math.PI + 2 * Math.PI * u[1]!;
    const x3 = -Math.PI + 2 * Math.PI * u[2]!;
    const s2 = Math.sin(x2);
    return Math.sin(x1) + ISHIGAMI_A * s2 * s2 + ISHIGAMI_B * Math.pow(x3, 4) * Math.sin(x1);
  },
};

/**
 * Ishigami's closed-form variance decomposition (Sobol' & Levitan; Homma &
 * Saltelli). Only `D₁`, `D₂` and `D₁₃` are non-zero, and they sum to `D`,
 * which the suite checks rather than assumes.
 */
function ishigamiAnalytics(): {
  first: number[];
  total: number[];
  interactionShare: number;
} {
  const a = ISHIGAMI_A;
  const b = ISHIGAMI_B;
  const pi4 = Math.PI ** 4;
  const pi8 = Math.PI ** 8;
  const d1 = (b * pi4) / 5 + (b * b * pi8) / 50 + 0.5;
  const d2 = (a * a) / 8;
  const d3 = 0;
  const d13 = b * b * pi8 * (1 / 18 - 1 / 50);
  const d = d1 + d2 + d3 + d13;
  return {
    first: [d1 / d, d2 / d, d3 / d],
    total: [(d1 + d13) / d, d2 / d, (d3 + d13) / d],
    interactionShare: d13 / d,
  };
}

describe("sobolIndices on the additive reference (P6.19's criterion)", () => {
  const analytics = additiveAnalytics(ADDITIVE_COEFFICIENTS);
  const result = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
    baseSamples: 4096,
    seed: 7,
  });

  it("matches the analytic first-order indices within the criterion's 0.05", () => {
    for (let k = 0; k < analytics.length; k++) {
      expect(result.indices[k]!.first).toBeCloseTo(analytics[k]!, 2);
      expect(Math.abs(result.indices[k]!.first - analytics[k]!)).toBeLessThan(0.05);
    }
  });

  it("matches the analytic total indices within the criterion's 0.05", () => {
    for (let k = 0; k < analytics.length; k++) {
      expect(Math.abs(result.indices[k]!.total - analytics[k]!)).toBeLessThan(0.05);
    }
  });

  it("finds no interaction, because the reference has none", () => {
    // Σ S_k = 1 and Σ S_T_k = 1 hold with equality *only* for an additive
    // model, so these two are the strongest available statement that the
    // estimator has not smeared variance between the two indices.
    expect(result.firstOrderSum).toBeCloseTo(1, 2);
    expect(result.totalSum).toBeCloseTo(1, 2);
    expect(Math.abs(result.interactionShare)).toBeLessThan(0.05);
    for (const index of result.indices) {
      expect(Math.abs(index.interaction)).toBeLessThan(0.05);
    }
  });

  it("costs exactly N(d + 2) evaluations and censors nothing", () => {
    expect(result.evaluations).toBe(4096 * 5);
    expect(result.failures).toBe(0);
    expect(result.censored).toBe(false);
  });

  it("brackets every index inside three of its own standard errors under random sampling", () => {
    // The i.i.d. standard-error formula is the quantity its name says *only*
    // for an independent sample, so this is where it can be tested as an error
    // bar at all. Three standard errors is a real statement about a
    // deterministic sample, not a hedge.
    const random = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 8192,
      sampling: "random",
      seed: 11,
    });
    for (let k = 0; k < analytics.length; k++) {
      const index = random.indices[k]!;
      expect(index.firstStandardError).toBeGreaterThan(0);
      expect(Math.abs(index.first - analytics[k]!)).toBeLessThan(3 * index.firstStandardError);
      expect(Math.abs(index.total - analytics[k]!)).toBeLessThan(3 * index.totalStandardError);
    }
  });

  it("is more accurate under Sobol' sampling than its own i.i.d. error bar admits", () => {
    // The module header says the reported standard error is an indicator of
    // scale under `"sobol"` and not a confidence interval, because the sample
    // is deliberately not independent. This is that statement measured rather
    // than asserted: on this problem and these seeds the actual deviation is
    // well inside the i.i.d. figure, which is the direction randomised QMC is
    // supposed to move it — and is exactly why the figure must not be read as
    // a confidence interval in either direction.
    for (let k = 0; k < analytics.length; k++) {
      const index = result.indices[k]!;
      expect(Math.abs(index.first - analytics[k]!)).toBeLessThan(index.firstStandardError);
    }
  });

  it("is unchanged by an offset on the output, because both samples are centred first", () => {
    // A regression test for a claim this module once made and did not meet.
    // The differenced form `f_B (f_k − f_A)` alone is invariant to `f → f + c`
    // only in expectation: the added `c (f_k − f_A)` has mean zero in the
    // limit but not in a finite sample, and at c = 1e6 against a spread of
    // order 1 it dominated — the first index came out 13.43 against an
    // analytic 0.762. Centring on the pooled mean makes the invariance exact,
    // and this assertion is what holds it there.
    const shifted = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS, 1e6), {
      baseSamples: 4096,
      seed: 7,
    });
    for (let k = 0; k < analytics.length; k++) {
      expect(shifted.indices[k]!.first).toBeCloseTo(result.indices[k]!.first, 6);
      expect(shifted.indices[k]!.total).toBeCloseTo(result.indices[k]!.total, 6);
    }
    expect(shifted.mean).toBeCloseTo(result.mean + 1e6, 6);
  });

  it("scales the same way under plain random sampling, more slowly", () => {
    // The point of asserting this at all: `"random"` is the mode whose
    // standard errors are the quantity their name says, so a convergence study
    // must be able to reach the same answer through it.
    const random = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 8192,
      sampling: "random",
      seed: 11,
    });
    for (let k = 0; k < analytics.length; k++) {
      expect(Math.abs(random.indices[k]!.first - analytics[k]!)).toBeLessThan(0.05);
      expect(Math.abs(random.indices[k]!.total - analytics[k]!)).toBeLessThan(0.05);
    }
  });

  it("is reproducible from its seed and moves when the seed moves", () => {
    const again = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 1024,
      seed: 7,
    });
    const twice = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 1024,
      seed: 7,
    });
    const other = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 1024,
      seed: 8,
    });
    expect(again.indices[0]!.first).toBe(twice.indices[0]!.first);
    expect(again.indices[0]!.first).not.toBe(other.indices[0]!.first);
  });
});

describe("sobolIndices on the Ishigami function (the interaction a tornado cannot see)", () => {
  const analytics = ishigamiAnalytics();
  const result = sobolIndices(ishigamiProblem, { baseSamples: 16384, seed: 3 });

  it("has an analytic reference whose parts sum to its whole", () => {
    // Guards the reference itself: D₁ + D₂ + D₃ + D₁₃ = D is an identity of
    // the closed form, and a typo in any term would otherwise show up as an
    // estimator error below.
    const sum = analytics.first[0]! + analytics.first[1]! + analytics.first[2]!;
    expect(sum + analytics.interactionShare).toBeCloseTo(1, 12);
  });

  it("matches the analytic first-order indices within 0.05", () => {
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(result.indices[k]!.first - analytics.first[k]!)).toBeLessThan(0.05);
    }
  });

  it("matches the analytic total indices within 0.05", () => {
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(result.indices[k]!.total - analytics.total[k]!)).toBeLessThan(0.05);
    }
  });

  it("finds x₃ influential only through its interaction with x₁", () => {
    // This is the whole reason the module exists. x₃'s first-order index is
    // exactly zero — vary it alone and the output's *mean* does not move — yet
    // roughly a quarter of the output variance disappears when it is fixed.
    // An OAT tornado bar for x₃ is short, and the short bar is a lie.
    expect(Math.abs(result.indices[2]!.first)).toBeLessThan(0.05);
    expect(result.indices[2]!.total).toBeGreaterThan(0.15);
    expect(result.indices[2]!.interaction).toBeGreaterThan(0.15);
  });

  it("finds x₂ purely additive, in the same run that finds x₃ purely interactive", () => {
    // x₂ enters as a sin² term with no partner, so S₂ = S_T₂ exactly. Having
    // both cases in one result is what says the estimator separates them
    // rather than applying a uniform bias.
    expect(Math.abs(result.indices[1]!.interaction)).toBeLessThan(0.05);
  });

  it("brackets 1 from both sides, as the identities require", () => {
    expect(result.firstOrderSum).toBeLessThan(1);
    expect(result.totalSum).toBeGreaterThan(1);
    expect(result.interactionShare).toBeCloseTo(analytics.interactionShare, 1);
  });
});

describe("sobolIndices structural guarantees", () => {
  it("keeps the total index non-negative even where the first-order one goes negative", () => {
    // Jansen's estimator is a mean of squares, so `total` cannot be negative
    // however small N is; the Saltelli first-order form can be, and is
    // reported unclamped because a negative value is the signal that N is too
    // small to resolve that input rather than a defect to hide.
    const noise: SobolIndexProblem = {
      inputs: ["signal", "irrelevant"],
      evaluate: (u) => u[0]!,
    };
    const result = sobolIndices(noise, { baseSamples: 64, seed: 5 });
    expect(result.indices[1]!.total).toBeGreaterThanOrEqual(0);
    expect(result.indices[0]!.first).toBeGreaterThan(0.8);
    // The irrelevant input's indices are both near zero at any N; the point of
    // the assertion is the sign guarantee above, not the value.
    expect(Math.abs(result.indices[1]!.first)).toBeLessThan(0.2);
  });

  it("reports censoring rather than quietly conditioning on success", () => {
    const partial: SobolIndexProblem = {
      inputs: ["a", "b"],
      evaluate: (u) => (u[0]! > 0.9 ? null : u[0]! + 0.5 * u[1]!),
    };
    const result = sobolIndices(partial, { baseSamples: 256, seed: 2 });
    expect(result.failures).toBeGreaterThan(0);
    expect(result.censored).toBe(true);
    // The indices still come back — a caller may want them — but `censored`
    // is what says they are conditional on the output existing.
    expect(Number.isFinite(result.indices[0]!.first)).toBe(true);
  });

  it("rejects a constant output rather than returning 0/0", () => {
    expect(() => sobolIndices({ inputs: ["a"], evaluate: () => 3 }, { baseSamples: 32 })).toThrow(
      /variance is zero/,
    );
  });

  it("rejects a non-finite evaluation, which null is the way to express", () => {
    expect(() =>
      sobolIndices({ inputs: ["a"], evaluate: () => Number.NaN }, { baseSamples: 32 }),
    ).toThrow(/return null/);
  });

  it("rejects an input count the pick-and-freeze construction cannot place", () => {
    const tooMany = Array.from({ length: MAX_SOBOL_INDEX_INPUTS + 1 }, (_, k) => `x${k}`);
    expect(() => sobolIndices({ inputs: tooMany, evaluate: () => 1 })).toThrow(/at most/);
  });

  it("rejects an empty problem and a sample too small for a variance", () => {
    expect(() => sobolIndices({ inputs: [], evaluate: () => 1 })).toThrow(/no inputs/);
    expect(() => sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), { baseSamples: 1 })).toThrow(
      /at least 2/,
    );
    expect(() => sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), { seed: -1 })).toThrow(
      /non-negative integer/,
    );
  });
});

/**
 * P0.113: the randomised-QMC error bar, and the measurement that says it is
 * one.
 *
 * **What was wrong.** `sobolIndices` reports its standard errors from the plain
 * i.i.d. formula, which is the right quantity only under `sampling: "random"`.
 * The default is `sampling: "sobol"`, whose points are negatively correlated on
 * purpose, so the figure there is an indicator of scale rather than a
 * confidence interval.
 *
 * **Why a coverage measurement and not an inequality.** It would be easy, and
 * wrong, to assert only that the new bar is *smaller* than the old one. A bar
 * can be smaller and still not be a standard error. The quantity that settles
 * it is the ratio of the *reported* error to the error the estimator *actually*
 * makes against a reference whose indices are known in closed form — one for an
 * honest bar, and whatever it happens to be for a dishonest one — together with
 * how often the interval actually contains the analytic value. Both are
 * measured below, on both references, and the numbers are recorded beside the
 * assertions they justify.
 *
 * Every seed here is fixed, so each number is a deterministic property of this
 * code rather than a hope about a random draw.
 */

/** The R = 16 configuration every measurement in this section shares. */
const RQMC_REPLICATES = 16;
const RQMC_BASE_SAMPLES = 256;
/** Independent studies per measurement — the sample the coverage is counted over. */
const RQMC_TRIALS = 40;
/** Student-t 97.5% point at R − 1 = 15 degrees of freedom. */
const T_975_AT_15_DOF = 2.131449545;

interface Calibration {
  /** RMS deviation of the estimates from the analytic value. */
  readonly actualRms: number;
  /** Mean of the reported standard errors. */
  readonly reportedMean: number;
  /** `reportedMean / actualRms`. One for an honest bar. */
  readonly ratio: number;
  /** Share of trials whose nominal-95% interval contained the analytic value. */
  readonly coverage: number;
}

/**
 * Runs `RQMC_TRIALS` independent studies and calibrates the reported error
 * against the error actually made.
 *
 * Trial `m` takes seeds `base + m·R … base + m·R + R − 1`, so the replicates
 * within a trial are distinct and no two trials share one.
 */
function calibrate(
  problem: SobolIndexProblem,
  analytic: readonly number[],
  select: (i: SobolIndex) => { value: number; standardError: number },
  options: { base: number; replicates: number; baseSamples: number; sampling?: "sobol" | "random" },
): Calibration[] {
  const estimates: number[][] = [];
  const errors: number[][] = [];
  for (let m = 0; m < RQMC_TRIALS; m++) {
    const result = sobolIndices(problem, {
      baseSamples: options.baseSamples,
      seed: options.base + m * RQMC_REPLICATES,
      ...(options.replicates > 1 ? { replicates: options.replicates } : {}),
      ...(options.sampling === undefined ? {} : { sampling: options.sampling }),
    });
    estimates.push(result.indices.map((i) => select(i).value));
    errors.push(result.indices.map((i) => select(i).standardError));
  }
  return analytic.map((target, k) => {
    const est = estimates.map((row) => row[k]!);
    const se = errors.map((row) => row[k]!);
    const actualRms = Math.sqrt(
      est.reduce((acc, v) => acc + (v - target) * (v - target), 0) / est.length,
    );
    const reportedMean = se.reduce((acc, v) => acc + v, 0) / se.length;
    let inside = 0;
    for (let m = 0; m < est.length; m++) {
      if (Math.abs(est[m]! - target) <= T_975_AT_15_DOF * se[m]!) inside += 1;
    }
    return {
      actualRms,
      reportedMean,
      ratio: reportedMean / actualRms,
      coverage: inside / est.length,
    };
  });
}

describe("P0.113: the replicate error bar is calibrated, and the measurement says so", () => {
  const additiveAnalytic = additiveAnalytics(ADDITIVE_COEFFICIENTS);
  const ishigami = ishigamiAnalytics();

  /**
   * The headline. Measured over 40 trials at R = 16, N = 256, the ratio of
   * reported error to actual RMS error came out:
   *
   * ```
   * additive  first  0.985 / 0.879 / 0.952      total  0.957 / 0.887 / 0.939
   * Ishigami  first  0.991 / 1.016 / 1.078      total  0.793 / 1.183 / 0.976
   * ```
   *
   * — twelve numbers between 0.79 and 1.18 across two references and both
   * index families. The bracket asserted is [0.5, 2.0]: wide enough that a
   * different machine's floating point cannot move it, and narrow enough that
   * the i.i.d. bar on this same path fails it by two orders of magnitude, which
   * the control below measures rather than assumes.
   */
  it("reports an error within a factor of two of the error it actually makes, on both references", () => {
    const cases: Array<{ label: string; calibration: Calibration[] }> = [
      {
        label: "additive first",
        calibration: calibrate(
          additiveProblem(ADDITIVE_COEFFICIENTS),
          additiveAnalytic,
          (i) => ({ value: i.first, standardError: i.firstStandardError }),
          { base: 10000, replicates: RQMC_REPLICATES, baseSamples: RQMC_BASE_SAMPLES },
        ),
      },
      {
        label: "additive total",
        calibration: calibrate(
          additiveProblem(ADDITIVE_COEFFICIENTS),
          additiveAnalytic,
          (i) => ({ value: i.total, standardError: i.totalStandardError }),
          { base: 10000, replicates: RQMC_REPLICATES, baseSamples: RQMC_BASE_SAMPLES },
        ),
      },
      {
        label: "Ishigami first",
        calibration: calibrate(
          ishigamiProblem,
          ishigami.first,
          (i) => ({ value: i.first, standardError: i.firstStandardError }),
          { base: 20000, replicates: RQMC_REPLICATES, baseSamples: RQMC_BASE_SAMPLES },
        ),
      },
      {
        label: "Ishigami total",
        calibration: calibrate(
          ishigamiProblem,
          ishigami.total,
          (i) => ({ value: i.total, standardError: i.totalStandardError }),
          { base: 20000, replicates: RQMC_REPLICATES, baseSamples: RQMC_BASE_SAMPLES },
        ),
      },
    ];
    for (const { label, calibration } of cases) {
      for (let k = 0; k < calibration.length; k++) {
        expect(calibration[k]!.ratio, `${label} k=${k}`).toBeGreaterThan(0.5);
        expect(calibration[k]!.ratio, `${label} k=${k}`).toBeLessThan(2);
      }
    }
  });

  /**
   * Coverage, counted rather than assumed. At a nominal 95% the measured shares
   * were 0.925-1.000 on the additive first-order indices and 0.900-0.975 on its
   * total indices, 0.925-0.950 on Ishigami's first-order indices, and
   * **0.825-0.975 on Ishigami's total indices** — the 0.825 being a real, mild
   * undercoverage on `S_T₁`, which is recorded here rather than tuned away.
   *
   * It is the expected direction: the t-interval assumes the R replicate
   * estimates are normal, and Jansen's estimator is a mean of squares and so
   * skewed, which bites hardest on the largest total index. The honest summary
   * is that this bar is a good error bar and not an exact one, and the
   * assertion is set at 0.75 to say exactly that — a bar that had no coverage
   * at all would sit near zero, not near 0.8.
   */
  it("covers the analytic value at close to the nominal rate, including where it falls short", () => {
    const calibration = calibrate(
      ishigamiProblem,
      ishigami.total,
      (i) => ({ value: i.total, standardError: i.totalStandardError }),
      { base: 20000, replicates: RQMC_REPLICATES, baseSamples: RQMC_BASE_SAMPLES },
    );
    for (let k = 0; k < calibration.length; k++) {
      expect(calibration[k]!.coverage, `Ishigami total k=${k}`).toBeGreaterThanOrEqual(0.75);
    }
    const additive = calibrate(
      additiveProblem(ADDITIVE_COEFFICIENTS),
      additiveAnalytic,
      (i) => ({ value: i.first, standardError: i.firstStandardError }),
      { base: 10000, replicates: RQMC_REPLICATES, baseSamples: RQMC_BASE_SAMPLES },
    );
    for (let k = 0; k < additive.length; k++) {
      expect(additive[k]!.coverage, `additive first k=${k}`).toBeGreaterThanOrEqual(0.75);
    }
  });

  /**
   * The control that makes the assertion above mean something: the same
   * calibration applied to the i.i.d. bar at a **matched evaluation budget**
   * (one study of `R·N` points rather than R studies of N).
   *
   * Measured ratios: **349 / 181 / 138** on the additive reference and
   * **3.7 / 8.1 / 2.7** on Ishigami. Both are overstatements, and the size of
   * the overstatement is a property of the integrand rather than a constant —
   * which is precisely why P0.113's filing refused to call "overstates" a
   * bound. Coverage on this path is 1.000 everywhere, and that is the trap
   * this whole section exists to avoid: **a bar that is far too wide covers
   * perfectly and is still not a standard error.**
   */
  it("fails that calibration on the i.i.d. bar at a matched budget, by two orders of magnitude", () => {
    const iid = calibrate(
      additiveProblem(ADDITIVE_COEFFICIENTS),
      additiveAnalytic,
      (i) => ({ value: i.first, standardError: i.firstStandardError }),
      { base: 10000, replicates: 1, baseSamples: RQMC_BASE_SAMPLES * RQMC_REPLICATES },
    );
    for (let k = 0; k < iid.length; k++) {
      expect(iid[k]!.ratio, `iid additive k=${k}`).toBeGreaterThan(20);
      // …and it covers perfectly while doing so, which is the point.
      expect(iid[k]!.coverage, `iid additive k=${k}`).toBe(1);
    }
  });

  /**
   * The second control, and the one that says the divergence above is the
   * sampler's doing rather than a bug in the replicate machinery.
   *
   * Under `sampling: "random"` the i.i.d. formula is exactly right, so the two
   * bars estimate the same quantity and must agree. Measured at a matched
   * budget, the i.i.d. bar is **1.072 / 1.065 / 1.027** times the replicate
   * bar, and the replicate bar's own calibration ratio is 1.116 / 0.965 /
   * 0.953 with coverage 0.950 / 1.000 / 0.925. So the new code reproduces the
   * old answer exactly where the old answer is right, and departs from it by
   * two orders of magnitude exactly where it is wrong.
   */
  it("agrees with the i.i.d. bar under sampling: 'random', where the i.i.d. bar is correct", () => {
    const replicate = calibrate(
      additiveProblem(ADDITIVE_COEFFICIENTS),
      additiveAnalytic,
      (i) => ({ value: i.first, standardError: i.firstStandardError }),
      {
        base: 50000,
        replicates: RQMC_REPLICATES,
        baseSamples: RQMC_BASE_SAMPLES,
        sampling: "random",
      },
    );
    const iid = calibrate(
      additiveProblem(ADDITIVE_COEFFICIENTS),
      additiveAnalytic,
      (i) => ({ value: i.first, standardError: i.firstStandardError }),
      {
        base: 50000,
        replicates: 1,
        baseSamples: RQMC_BASE_SAMPLES * RQMC_REPLICATES,
        sampling: "random",
      },
    );
    for (let k = 0; k < replicate.length; k++) {
      const agreement = iid[k]!.reportedMean / replicate[k]!.reportedMean;
      expect(agreement, `random k=${k}`).toBeGreaterThan(0.5);
      expect(agreement, `random k=${k}`).toBeLessThan(2);
      expect(replicate[k]!.ratio, `random k=${k}`).toBeGreaterThan(0.5);
      expect(replicate[k]!.ratio, `random k=${k}`).toBeLessThan(2);
    }
  });
});

describe("P0.113: replicates is opt-in and says so", () => {
  it("leaves the default path bit-for-bit unchanged", () => {
    // The reason replicates defaults to 1 rather than to a useful R: raising it
    // would multiply every existing caller's cost, and paying for it out of N
    // would degrade every existing estimate. Neither should happen to someone
    // who did not ask.
    const implicit = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 128,
      seed: 3,
    });
    const explicit = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 128,
      seed: 3,
      replicates: 1,
    });
    expect(JSON.stringify(implicit)).toBe(JSON.stringify(explicit));
    expect(implicit.replicates).toBe(1);
    expect(implicit.standardErrorMethod).toBe("iid");
  });

  it("names the method on the result rather than leaving it to be inferred", () => {
    const result = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 64,
      seed: 11,
      replicates: 4,
    });
    expect(result.standardErrorMethod).toBe("replicate");
    expect(result.replicates).toBe(4);
  });

  it("charges R times the evaluations rather than dividing N by R", () => {
    const single = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 64,
      seed: 11,
    });
    const many = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 64,
      seed: 11,
      replicates: 4,
    });
    expect(many.evaluations).toBe(4 * single.evaluations);
    expect(many.baseSamples).toBe(single.baseSamples);
  });

  it("averages exactly the replicates its seeds name", () => {
    // The aggregate must be the mean of the studies a caller could have run by
    // hand at seeds s … s+R−1, not of some other set. Checked against those
    // studies rather than against a recomputation of the same arithmetic.
    const R = 5;
    const seed = 41;
    const many = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
      baseSamples: 64,
      seed,
      replicates: R,
    });
    const byHand: number[][] = [];
    for (let r = 0; r < R; r++) {
      const one = sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
        baseSamples: 64,
        seed: seed + r,
      });
      byHand.push(one.indices.map((i) => i.first));
    }
    for (let k = 0; k < many.indices.length; k++) {
      const column = byHand.map((row) => row[k]!);
      const mean = column.reduce((a, v) => a + v, 0) / R;
      expect(many.indices[k]!.first).toBeCloseTo(mean, 12);
      const m2 = column.reduce((a, v) => a + (v - mean) * (v - mean), 0);
      expect(many.indices[k]!.firstStandardError).toBeCloseTo(Math.sqrt(m2 / (R - 1) / R), 12);
    }
  });

  it("refuses replicate seeds that would alias onto each other", () => {
    // Aliased seeds do not fail loudly — they produce duplicate "independent"
    // replicates, shrinking the spread and reporting an error bar that is too
    // small. That is the one failure mode of this feature that would look like
    // a better result, so it throws.
    expect(() =>
      sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), {
        baseSamples: 32,
        seed: 0xffffffff - 1,
        replicates: 4,
      }),
    ).toThrow(/alias/);
  });

  it("rejects a replicate count that is not a positive integer", () => {
    expect(() =>
      sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), { baseSamples: 32, replicates: 0 }),
    ).toThrow(/at least 1/);
    expect(() =>
      sobolIndices(additiveProblem(ADDITIVE_COEFFICIENTS), { baseSamples: 32, replicates: 2.5 }),
    ).toThrow(/at least 1/);
  });
});
