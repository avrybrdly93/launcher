import { describe, expect, it } from "vitest";
import { normalQuantile } from "@ballista/engine";
import {
  coverageOfMean,
  formatMeanConfidenceInterval,
  meanConfidenceInterval,
  studentTCdf,
  studentTQuantile,
  studentTUpperTail,
} from "./confidence-interval.js";

/**
 * The `t` machinery is validated against closed forms wherever one exists,
 * rather than against a table of digits copied from somewhere. `df = 1` and
 * `df = 2` have exact inverses in elementary functions, and `df → ∞` is the
 * normal quantile the `engine` package already validates to 1e-14 -- so three
 * independent anchors pin the family at both ends and in the middle, and the
 * round-trip check `Q(quantile(p)) === 1 - p` holds it everywhere in between to
 * machine precision.
 *
 * The textbook 95% multipliers appear too, but only to three decimals, which is
 * all a published table carries. They are there to catch a wholesale error --
 * an off-by-one in the degrees of freedom, a one-sided/two-sided mix-up -- that
 * the self-consistency checks would happily satisfy.
 */

/** Exact: the `df = 1` Student-t is the standard Cauchy. */
function cauchyQuantile(p: number): number {
  return Math.tan(Math.PI * (p - 0.5));
}

/**
 * Exact for `df = 2`. From `F(t) = 1/2 + t / (2√(2 + t²))`, inverting gives
 * `t = (2p - 1) · √(2 / (4p(1-p)))`.
 */
function df2Quantile(p: number): number {
  return (2 * p - 1) * Math.sqrt(2 / (4 * p * (1 - p)));
}

describe("studentTUpperTail / studentTCdf", () => {
  it("is one half at the origin for every df", () => {
    for (const df of [0.5, 1, 2, 7, 30, 1e4]) {
      expect(studentTCdf(0, df)).toBeCloseTo(0.5, 15);
      expect(studentTUpperTail(0, df)).toBeCloseTo(0.5, 15);
    }
  });

  it("matches the Cauchy cdf exactly at df = 1", () => {
    for (const t of [-8, -2.5, -1, -0.25, 0.25, 1, 2.5, 8]) {
      const exact = 0.5 + Math.atan(t) / Math.PI;
      expect(studentTCdf(t, 1)).toBeCloseTo(exact, 13);
    }
  });

  it("matches the closed form exactly at df = 2", () => {
    for (const t of [-6, -1.5, -0.3, 0.3, 1.5, 6]) {
      const exact = 0.5 + t / (2 * Math.sqrt(2 + t * t));
      expect(studentTCdf(t, 2)).toBeCloseTo(exact, 13);
    }
  });

  it("is symmetric: Q(-t) = 1 - Q(t)", () => {
    for (const df of [1, 3, 12, 250]) {
      for (const t of [0.4, 1.3, 3.7]) {
        expect(studentTUpperTail(-t, df)).toBeCloseTo(1 - studentTUpperTail(t, df), 14);
      }
    }
  });

  it("approaches the normal cdf as df grows", () => {
    // 1e7 df puts the t within ~1e-8 of normal; the point is the trend.
    const far = studentTCdf(1.959963984540054, 1e7);
    expect(far).toBeCloseTo(0.975, 7);
  });

  it("computes a deep tail as itself rather than by subtraction", () => {
    // At df = 30 the 6-sigma tail is ~6e-7. If this were 1 - cdf it would still
    // be roughly right today; the assertion is that it is positive and of the
    // right order, which `1 - cdf` stops being once the tail passes 1e-16.
    const q = studentTUpperTail(12, 30);
    expect(q).toBeGreaterThan(0);
    expect(q).toBeLessThan(1e-11);
  });

  it("rejects a non-positive or non-finite df, and a non-finite t", () => {
    expect(() => studentTUpperTail(1, 0)).toThrow(/degrees of freedom/);
    expect(() => studentTUpperTail(1, -3)).toThrow(/degrees of freedom/);
    expect(() => studentTUpperTail(1, Number.NaN)).toThrow(/degrees of freedom/);
    expect(() => studentTUpperTail(Number.POSITIVE_INFINITY, 5)).toThrow(/finite/);
  });
});

describe("studentTQuantile", () => {
  it("is zero at the median", () => {
    for (const df of [1, 2, 9, 4000]) {
      expect(studentTQuantile(0.5, df)).toBe(0);
    }
  });

  /**
   * Relative, not absolute. `t_{0.9995, 1}` is 636.6, where vitest's
   * `toBeCloseTo(x, 10)` demands an absolute 5e-11 -- i.e. fourteen significant
   * digits, tighter than the incomplete beta can deliver and tighter than
   * anything here needs. Every accuracy claim below is therefore written as a
   * relative one.
   */
  function expectRelative(actual: number, expected: number, tolerance = 1e-12): void {
    expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tolerance);
  }

  it("matches the exact Cauchy inverse at df = 1", () => {
    for (const p of [0.6, 0.75, 0.9, 0.975, 0.995, 0.9995]) {
      expectRelative(studentTQuantile(p, 1), cauchyQuantile(p));
    }
  });

  it("matches the exact closed form at df = 2", () => {
    for (const p of [0.55, 0.8, 0.95, 0.99, 0.9999]) {
      expectRelative(studentTQuantile(p, 2), df2Quantile(p));
    }
  });

  it("round-trips through the upper tail", () => {
    /**
     * The accuracy floor here is the incomplete beta's, not the root find's.
     * `studentTQuantile` converges its bracket to a relative 1e-15 in `t`, but
     * it is converging against `studentTUpperTail`, so the round-trip can only
     * be as good as that function -- about 1e-12 relative from the continued
     * fraction. Asserting 1e-15 here would be asserting a precision the
     * underlying special function does not have, and would break on any future
     * change to the fraction's convergence criterion for no good reason.
     */
    for (const df of [1, 2, 3, 5, 8, 13, 40, 199, 5000]) {
      for (const p of [0.6, 0.9, 0.95, 0.975, 0.99, 0.999]) {
        const t = studentTQuantile(p, df);
        expectRelative(studentTUpperTail(t, df), 1 - p);
      }
    }
  });

  it("reproduces the published two-sided 95% multipliers", () => {
    // t_{0.975, df} for df = 1..10, as any statistics text prints them.
    const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
    table.forEach((expected, i) => {
      expect(studentTQuantile(0.975, i + 1)).toBeCloseTo(expected, 3);
    });
  });

  it("converges downward to the normal quantile as df grows", () => {
    const z = normalQuantile(0.975);
    let previous = Number.POSITIVE_INFINITY;
    for (const df of [2, 5, 20, 100, 1000, 100000]) {
      const t = studentTQuantile(0.975, df);
      expect(t).toBeGreaterThan(z); // the t multiplier is always the wider one
      expect(t).toBeLessThan(previous); // and it shrinks monotonically toward z
      previous = t;
    }
    expect(studentTQuantile(0.975, 1e8)).toBeCloseTo(z, 7);
  });

  it("is antisymmetric about the median", () => {
    for (const df of [1, 4, 60]) {
      expect(studentTQuantile(0.1, df)).toBeCloseTo(-studentTQuantile(0.9, df), 12);
    }
  });

  it("rejects p outside the open unit interval", () => {
    for (const p of [0, 1, -0.2, 1.5, Number.NaN]) {
      expect(() => studentTQuantile(p, 5)).toThrow(/strictly inside/);
    }
    expect(() => studentTQuantile(0.9, 0)).toThrow(/degrees of freedom/);
  });
});

describe("meanConfidenceInterval", () => {
  it("centres on the sample mean and is symmetric about it", () => {
    const ci = meanConfidenceInterval([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(ci.mean).toBeCloseTo(5, 12);
    expect(ci.upper - ci.mean).toBeCloseTo(ci.mean - ci.lower, 12);
    expect(ci.halfWidth).toBeCloseTo(ci.upper - ci.mean, 12);
  });

  it("reports the sample size and degrees of freedom it used", () => {
    const ci = meanConfidenceInterval([1, 2, 3, 4, 5])!;
    expect(ci.sampleSize).toBe(5);
    expect(ci.degreesOfFreedom).toBe(4);
    expect(ci.level).toBe(0.95);
  });

  it("uses the two-sided multiplier, not the one-sided one", () => {
    // The commonest way to get this wrong: t at `level` rather than at
    // `1 - (1-level)/2`. At df = 4 that is 2.132 instead of 2.776.
    const ci = meanConfidenceInterval([1, 2, 3, 4, 5])!;
    expect(ci.tCritical).toBeCloseTo(2.776, 3);
  });

  it("is a known worked example end to end", () => {
    // [2,4,4,4,5,5,7,9]: mean 5; deviations -3,-1,-1,-1,0,0,2,4; squares sum to
    // 32. So s^2 = 32/7 (Bessel-corrected, NOT 32/8 -- the population figure of
    // 2 is the trap here) and SE = sqrt(32/7)/sqrt(8) = sqrt(4/7).
    const ci = meanConfidenceInterval([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(ci.mean).toBeCloseTo(5, 12);
    expect(ci.standardError).toBeCloseTo(Math.sqrt(4 / 7), 12);
    const expectedHalf = studentTQuantile(0.975, 7) * Math.sqrt(4 / 7);
    expect(ci.halfWidth).toBeCloseTo(expectedHalf, 12);
    expect(ci.lower).toBeCloseTo(5 - expectedHalf, 12);
    expect(ci.upper).toBeCloseTo(5 + expectedHalf, 12);
  });

  it("widens with the level and narrows with the sample size", () => {
    const sample = [10, 12, 9, 11, 13, 8, 12, 10];
    const ninety = meanConfidenceInterval(sample, 0.9)!;
    const ninetyNine = meanConfidenceInterval(sample, 0.99)!;
    expect(ninetyNine.halfWidth).toBeGreaterThan(ninety.halfWidth);

    // Same spread, four times the samples: half the standard error.
    const quadrupled = [...sample, ...sample, ...sample, ...sample];
    expect(meanConfidenceInterval(quadrupled)!.standardError).toBeLessThan(
      meanConfidenceInterval(sample)!.standardError,
    );
  });

  it("returns null below two samples rather than a zero-width interval", () => {
    expect(meanConfidenceInterval([])).toBeNull();
    expect(meanConfidenceInterval([42])).toBeNull();
  });

  it("gives a zero-width interval for a degenerate sample", () => {
    const ci = meanConfidenceInterval([3, 3, 3, 3])!;
    expect(ci.standardError).toBe(0);
    expect(ci.halfWidth).toBe(0);
    expect(ci.lower).toBe(3);
    expect(ci.upper).toBe(3);
  });

  it("throws on a non-finite sample rather than dropping it", () => {
    expect(() => meanConfidenceInterval([1, 2, Number.NaN])).toThrow(/non-finite/);
    expect(() => meanConfidenceInterval([1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
  });

  it("rejects a level outside the open unit interval", () => {
    for (const level of [0, 1, -0.5, 2]) {
      expect(() => meanConfidenceInterval([1, 2, 3], level)).toThrow(/confidence level/);
    }
  });
});

describe("formatMeanConfidenceInterval", () => {
  it("always states the level and the sample size", () => {
    const ci = meanConfidenceInterval([2, 4, 4, 4, 5, 5, 7, 9])!;
    const text = formatMeanConfidenceInterval(ci, { unit: "m" });
    expect(text).toContain("n = 8");
    expect(text).toContain("95% CI");
    // SE = sqrt(4/7) = 0.75593, t_{0.975,7} = 2.36462, half-width 1.78744.
    expect(text).toMatch(/^5\.00 ± 1\.79 m \(95% CI, n = 8\)$/);
  });

  it("honours digits and omits the unit when there is none", () => {
    // [1..5]: mean 3, s^2 = 10/4, SE = sqrt(2.5)/sqrt(5) = 0.707107,
    // t_{0.975,4} = 2.776445, half-width 1.963243.
    const ci = meanConfidenceInterval([1, 2, 3, 4, 5])!;
    expect(formatMeanConfidenceInterval(ci, { digits: 4 })).toMatch(
      /^3\.0000 ± 1\.9632 \(95% CI, n = 5\)$/,
    );
  });

  it("renders a non-round level without floating-point litter", () => {
    const ci = meanConfidenceInterval([1, 2, 3, 4, 5], 0.9)!;
    expect(formatMeanConfidenceInterval(ci)).toContain("(90% CI");
    const odd = meanConfidenceInterval([1, 2, 3, 4, 5], 0.995)!;
    expect(formatMeanConfidenceInterval(odd)).toContain("(99.5% CI");
  });
});

describe("coverageOfMean", () => {
  /**
   * A deterministic pseudo-normal generator, local to this file. The point of
   * these tests is the counting logic and the reported scale, not the pipeline
   * -- the criterion itself is measured in `runtime` against real replicates.
   */
  function normalSamples(count: number, size: number, mean: number, sd: number): number[][] {
    let state = 0x2545f491;
    const next = (): number => {
      state = (state * 1103515245 + 12345) >>> 0;
      return (state + 0.5) / 4294967296;
    };
    const out: number[][] = [];
    for (let i = 0; i < count; i++) {
      const sample: number[] = [];
      for (let j = 0; j < size; j++) {
        sample.push(mean + sd * normalQuantile(next()));
      }
      out.push(sample);
    }
    return out;
  }

  it("counts an interval that contains the truth and one that does not", () => {
    const result = coverageOfMean(
      [
        [0, 0, 0],
        [10, 10, 10],
      ],
      0,
      0.95,
    );
    expect(result.repeats).toBe(2);
    expect(result.covered).toBe(1);
    expect(result.coverage).toBe(0.5);
  });

  it("skips samples too small to form an interval instead of counting them as misses", () => {
    const result = coverageOfMean([[1], [], [0, 0, 0]], 0);
    expect(result.skipped).toBe(2);
    expect(result.repeats).toBe(1);
    expect(result.covered).toBe(1);
  });

  it("reports the binomial scale any assertion on coverage must use", () => {
    const result = coverageOfMean(normalSamples(200, 8, 5, 2), 5, 0.95);
    expect(result.standardError).toBeCloseTo(Math.sqrt((0.95 * 0.05) / 200), 15);
    expect(result.nominal).toBe(0.95);
  });

  it("covers about the nominal fraction on normal data", () => {
    const result = coverageOfMean(normalSamples(400, 10, 5, 2), 5, 0.95);
    expect(Math.abs(result.coverage - 0.95)).toBeLessThan(3 * result.standardError);
  });

  it("tracks the level: an 80% interval covers about 80%", () => {
    const result = coverageOfMean(normalSamples(400, 10, 5, 2), 5, 0.8);
    expect(Math.abs(result.coverage - 0.8)).toBeLessThan(3 * result.standardError);
  });

  it("collapses when the truth is wrong -- the counterexample", () => {
    // Truth displaced by many standard errors: coverage must fall to nothing,
    // otherwise the counter is not actually testing containment.
    const result = coverageOfMean(normalSamples(200, 10, 5, 2), 25, 0.95);
    expect(result.coverage).toBe(0);
  });

  it("returns NaN rather than 0/0 when nothing could be counted", () => {
    const result = coverageOfMean([[1], []], 0);
    expect(result.repeats).toBe(0);
    expect(Number.isNaN(result.coverage)).toBe(true);
    expect(Number.isNaN(result.standardError)).toBe(true);
  });

  it("rejects a non-finite truth", () => {
    expect(() => coverageOfMean([[1, 2]], Number.NaN)).toThrow(/truth must be finite/);
  });
});
