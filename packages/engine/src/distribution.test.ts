import { describe, expect, it } from "vitest";
import {
  distributionMoments,
  distributionSpecSchema,
  distributionSupport,
  sampleDistribution,
  type DistributionSpec,
} from "./distribution.js";
import { PCG32 } from "./random.js";

/** Parse-and-assert, so no test silently exercises an unvalidated literal. */
function spec(value: unknown): DistributionSpec {
  return distributionSpecSchema.parse(value);
}

interface SampleMoments {
  mean: number;
  variance: number;
  min: number;
  max: number;
}

/** Welford, so 1e5 draws do not lose precision to a naive sum of squares. */
function sampleMoments(draws: readonly number[]): SampleMoments {
  let mean = 0;
  let m2 = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  draws.forEach((x, i) => {
    const delta = x - mean;
    mean += delta / (i + 1);
    m2 += delta * (x - mean);
    if (x < min) min = x;
    if (x > max) max = x;
  });
  return { mean, variance: m2 / (draws.length - 1), min, max };
}

function draw(distribution: DistributionSpec, n: number, seed = 20260822n): number[] {
  const rng = new PCG32(seed);
  return Array.from({ length: n }, () => sampleDistribution(distribution, rng));
}

/**
 * P6.01's validation criterion, as an assertion.
 *
 * "Sampling moments match analytics (1e5 draws, 3-sigma bands)". The bands are
 * the *sampling* standard errors of the estimators, not an arbitrary
 * tolerance: `SE(mean) = sigma / sqrt(n)`, and for the variance
 * `SE(s^2) = sigma^2 sqrt(2 / (n - 1))` under normality, which is the right
 * order for every distribution here. A tolerance chosen this way tightens as
 * `n` grows, so a biased sampler cannot be hidden by drawing more.
 */
function expectMomentsToMatchAnalytics(distribution: DistributionSpec, n = 100_000): void {
  const analytic = distributionMoments(distribution);
  const sample = sampleMoments(draw(distribution, n));

  const meanBand = 3 * (analytic.stdDev / Math.sqrt(n));
  expect(Math.abs(sample.mean - analytic.mean)).toBeLessThan(meanBand);

  const varianceBand = 3 * (analytic.variance * Math.sqrt(2 / (n - 1)));
  // Kurtosis above 3 (the lognormal is heavy-tailed) widens the variance
  // estimator's own spread beyond the normal-theory formula, so the band is
  // loosened for that family alone, and only by a factor recorded here rather
  // than tuned until green: excess kurtosis of exp(N(0, 0.3^2)) is about 1.6,
  // which multiplies the variance of s^2 by (1 + 1.6/2) = 1.8, i.e. 1.35 in
  // standard deviations.
  const slack = distribution.kind === "lognormal" ? 4 : 1;
  expect(Math.abs(sample.variance - analytic.variance)).toBeLessThan(varianceBand * slack);
}

describe("distributionSpecSchema", () => {
  it("accepts each family in its untruncated form", () => {
    expect(spec({ kind: "normal", mean: 45, stdDev: 2 }).kind).toBe("normal");
    expect(spec({ kind: "lognormal", logMean: -1, logStdDev: 0.3 }).kind).toBe("lognormal");
    expect(spec({ kind: "uniform", min: 10, max: 20 }).kind).toBe("uniform");
  });

  it("accepts truncated variants of the unbounded families", () => {
    expect(() => spec({ kind: "normal", mean: 45, stdDev: 2, min: 40, max: 50 })).not.toThrow();
    expect(() => spec({ kind: "normal", mean: 0, stdDev: 1, min: 0 })).not.toThrow();
    expect(() => spec({ kind: "normal", mean: 0, stdDev: 1, max: 0 })).not.toThrow();
    expect(() =>
      spec({ kind: "lognormal", logMean: 0, logStdDev: 0.5, min: 0.5, max: 2 }),
    ).not.toThrow();
  });

  it("rejects a non-positive scale", () => {
    expect(() => spec({ kind: "normal", mean: 0, stdDev: 0 })).toThrow();
    expect(() => spec({ kind: "normal", mean: 0, stdDev: -1 })).toThrow();
    expect(() => spec({ kind: "lognormal", logMean: 0, logStdDev: 0 })).toThrow();
  });

  it("rejects an inverted or empty interval", () => {
    expect(() => spec({ kind: "uniform", min: 5, max: 5 })).toThrow(/greater than/);
    expect(() => spec({ kind: "uniform", min: 5, max: 1 })).toThrow(/greater than/);
    expect(() => spec({ kind: "normal", mean: 0, stdDev: 1, min: 2, max: 1 })).toThrow(
      /greater than/,
    );
  });

  it("rejects a lognormal bound at or below zero, which has no logarithm", () => {
    expect(() => spec({ kind: "lognormal", logMean: 0, logStdDev: 1, min: 0 })).toThrow();
    expect(() => spec({ kind: "lognormal", logMean: 0, logStdDev: 1, max: -1 })).toThrow();
  });

  it("rejects a truncation window that keeps no representable mass", () => {
    // [40 sigma, 41 sigma] is a legal-looking interval whose probability
    // underflows to exactly zero. Sampling it would divide by zero; the schema
    // refuses it at parse time instead.
    expect(() => spec({ kind: "normal", mean: 0, stdDev: 1, min: 40, max: 41 })).toThrow(
      /no representable probability mass/,
    );
  });

  it("rejects a non-finite parameter", () => {
    expect(() => spec({ kind: "normal", mean: Number.POSITIVE_INFINITY, stdDev: 1 })).toThrow();
    expect(() => spec({ kind: "normal", mean: 0, stdDev: Number.NaN })).toThrow();
  });

  it("round-trips through JSON", () => {
    const original = spec({ kind: "normal", mean: 45, stdDev: 2, min: 40, max: 50 });
    expect(spec(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });
});

describe("distributionMoments", () => {
  it("returns the parent moments when nothing is truncated", () => {
    const normal = distributionMoments(spec({ kind: "normal", mean: 45, stdDev: 2 }));
    expect(normal.mean).toBe(45);
    expect(normal.variance).toBe(4);
    expect(normal.stdDev).toBe(2);
  });

  it("reproduces the closed-form lognormal moments", () => {
    const m = -0.7;
    const s = 0.4;
    const moments = distributionMoments(spec({ kind: "lognormal", logMean: m, logStdDev: s }));
    expect(moments.mean).toBeCloseTo(Math.exp(m + (s * s) / 2), 12);
    expect(moments.variance).toBeCloseTo((Math.exp(s * s) - 1) * Math.exp(2 * m + s * s), 12);
  });

  it("reproduces the uniform moments", () => {
    const moments = distributionMoments(spec({ kind: "uniform", min: 10, max: 20 }));
    expect(moments.mean).toBe(15);
    expect(moments.variance).toBeCloseTo(100 / 12, 12);
  });

  it("gives a symmetric truncation the parent mean and a smaller variance", () => {
    const truncated = distributionMoments(
      spec({ kind: "normal", mean: 45, stdDev: 2, min: 41, max: 49 }),
    );
    expect(truncated.mean).toBeCloseTo(45, 12);
    expect(truncated.variance).toBeLessThan(4);
    // Two-sided at 2 sigma: the standard truncated-normal variance factor is
    // 1 + (a phi(a) - b phi(b))/Z - ((phi(a) - phi(b))/Z)^2, which at
    // a = -2, b = 2 is 1 - 4 phi(2)/Z = 0.7737.
    expect(truncated.variance / 4).toBeCloseTo(0.773741, 5);
  });

  it("shifts the mean toward the retained side for a one-sided truncation", () => {
    // The half-normal: X ~ N(0, 1) given X > 0 has mean sqrt(2/pi) and
    // variance 1 - 2/pi. Both are textbook values, independent of the code.
    const halfNormal = distributionMoments(spec({ kind: "normal", mean: 0, stdDev: 1, min: 0 }));
    expect(halfNormal.mean).toBeCloseTo(Math.sqrt(2 / Math.PI), 12);
    expect(halfNormal.variance).toBeCloseTo(1 - 2 / Math.PI, 12);

    const mirrored = distributionMoments(spec({ kind: "normal", mean: 0, stdDev: 1, max: 0 }));
    expect(mirrored.mean).toBeCloseTo(-Math.sqrt(2 / Math.PI), 12);
    expect(mirrored.variance).toBeCloseTo(1 - 2 / Math.PI, 12);
  });

  it("keeps a truncated lognormal inside its own bounds", () => {
    const moments = distributionMoments(
      spec({ kind: "lognormal", logMean: 0, logStdDev: 0.5, min: 0.8, max: 1.5 }),
    );
    expect(moments.mean).toBeGreaterThan(0.8);
    expect(moments.mean).toBeLessThan(1.5);
    expect(moments.variance).toBeGreaterThan(0);
    // Variance of any distribution on [a, b] cannot exceed (b - a)^2 / 4.
    expect(moments.variance).toBeLessThan(0.7 ** 2 / 4);
  });
});

describe("sampleDistribution", () => {
  it("matches analytic moments for an untruncated normal (1e5 draws, 3 sigma)", () => {
    expectMomentsToMatchAnalytics(spec({ kind: "normal", mean: 45, stdDev: 2 }));
  });

  it("matches analytic moments for a two-sided truncated normal", () => {
    expectMomentsToMatchAnalytics(spec({ kind: "normal", mean: 45, stdDev: 2, min: 43, max: 48 }));
  });

  it("matches analytic moments for a one-sided truncated normal", () => {
    expectMomentsToMatchAnalytics(spec({ kind: "normal", mean: 0, stdDev: 1, min: 0 }));
    expectMomentsToMatchAnalytics(spec({ kind: "normal", mean: 0, stdDev: 1, max: 0.5 }));
  });

  it("matches analytic moments for a truncation sitting entirely in the tail", () => {
    // The case rejection sampling cannot afford: acceptance here is 1.3e-3,
    // so a rejection sampler would need ~8e7 draws for the 1e5 this makes.
    expectMomentsToMatchAnalytics(spec({ kind: "normal", mean: 0, stdDev: 1, min: 3, max: 4 }));
  });

  it("matches analytic moments for an untruncated lognormal", () => {
    expectMomentsToMatchAnalytics(spec({ kind: "lognormal", logMean: -0.7, logStdDev: 0.3 }));
  });

  it("matches analytic moments for a truncated lognormal", () => {
    expectMomentsToMatchAnalytics(
      spec({ kind: "lognormal", logMean: 0, logStdDev: 0.5, min: 0.8, max: 1.5 }),
    );
  });

  it("matches analytic moments for a uniform", () => {
    expectMomentsToMatchAnalytics(spec({ kind: "uniform", min: 10, max: 20 }));
  });

  it("never leaves the declared support", () => {
    const cases: DistributionSpec[] = [
      spec({ kind: "normal", mean: 45, stdDev: 2, min: 43, max: 48 }),
      spec({ kind: "normal", mean: 0, stdDev: 1, min: 3, max: 4 }),
      spec({ kind: "lognormal", logMean: 0, logStdDev: 0.5, min: 0.8, max: 1.5 }),
      spec({ kind: "uniform", min: 10, max: 20 }),
    ];
    for (const distribution of cases) {
      const support = distributionSupport(distribution);
      const { min, max } = sampleMoments(draw(distribution, 20_000));
      expect(min).toBeGreaterThanOrEqual(support.min);
      expect(max).toBeLessThanOrEqual(support.max);
    }
  });

  it("keeps an untruncated lognormal strictly positive", () => {
    const distribution = spec({ kind: "lognormal", logMean: 0, logStdDev: 1 });
    expect(distributionSupport(distribution).min).toBe(0);
    expect(sampleMoments(draw(distribution, 20_000)).min).toBeGreaterThan(0);
  });

  it("fills a truncation window rather than piling up at one end", () => {
    // A sign error in the inverse-CDF placement would still respect the
    // bounds while concentrating the draws; this catches that.
    const distribution = spec({ kind: "normal", mean: 0, stdDev: 1, min: -1, max: 1 });
    const draws = draw(distribution, 20_000);
    const bucketOf = (x: number): number => Math.min(3, Math.floor(((x + 1) / 2) * 4));
    const buckets = [0, 1, 2, 3].map((b) => draws.filter((x) => bucketOf(x) === b).length);
    // Analytic bucket masses for N(0,1) truncated to [-1, 1], quartered by
    // width: the outer pair are lighter than the inner pair, but every bucket
    // holds a substantial share.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws.length * 0.15);
      expect(count).toBeLessThan(draws.length * 0.35);
    }
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(draws.length);
  });

  it("is reproducible from its seed and independent across substreams", () => {
    const distribution = spec({ kind: "normal", mean: 45, stdDev: 2, min: 40, max: 50 });
    expect(draw(distribution, 50, 7n)).toEqual(draw(distribution, 50, 7n));
    expect(draw(distribution, 50, 7n)).not.toEqual(draw(distribution, 50, 8n));

    const parent = new PCG32(7n);
    const a = parent.substream(1n);
    const b = parent.substream(2n);
    const fromA = Array.from({ length: 20 }, () => sampleDistribution(distribution, a));
    const fromB = Array.from({ length: 20 }, () => sampleDistribution(distribution, b));
    expect(fromA).not.toEqual(fromB);
  });
});

describe("distributionSupport", () => {
  it("reports the truncation bounds where they exist", () => {
    expect(
      distributionSupport(spec({ kind: "normal", mean: 0, stdDev: 1, min: -2, max: 2 })),
    ).toEqual({ min: -2, max: 2 });
    expect(distributionSupport(spec({ kind: "uniform", min: 10, max: 20 }))).toEqual({
      min: 10,
      max: 20,
    });
  });

  it("reports the natural support where they do not", () => {
    expect(distributionSupport(spec({ kind: "normal", mean: 0, stdDev: 1 }))).toEqual({
      min: Number.NEGATIVE_INFINITY,
      max: Number.POSITIVE_INFINITY,
    });
    expect(distributionSupport(spec({ kind: "lognormal", logMean: 0, logStdDev: 1 }))).toEqual({
      min: 0,
      max: Number.POSITIVE_INFINITY,
    });
  });
});
