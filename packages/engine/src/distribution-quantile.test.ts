import { describe, expect, it } from "vitest";
import {
  distributionQuantile,
  distributionSpecSchema,
  sampleDistribution,
  type DistributionSpec,
} from "./distribution.js";
import { normalCdf } from "./normal-distribution-functions.js";
import { PCG32 } from "./random.js";

/** Parse-and-assert, so no test silently exercises an unvalidated literal. */
function spec(value: unknown): DistributionSpec {
  return distributionSpecSchema.parse(value);
}

/**
 * The specs the quantile has to get right, spanning every branch: uniform, the
 * Box-Muller-backed untruncated normal and lognormal, one-sided and two-sided
 * truncation, and -- the case with its own reflection branch -- an interval
 * lying entirely below zero.
 */
const SPECS: ReadonlyArray<readonly [name: string, spec: DistributionSpec]> = [
  ["uniform", spec({ kind: "uniform", min: -3, max: 7 })],
  ["normal, untruncated", spec({ kind: "normal", mean: 12, stdDev: 2.5 })],
  ["normal, truncated both sides", spec({ kind: "normal", mean: 0, stdDev: 1, min: -1, max: 2 })],
  ["normal, truncated below only", spec({ kind: "normal", mean: 5, stdDev: 3, min: 4 })],
  ["normal, interval entirely negative", spec({ kind: "normal", mean: 0, stdDev: 1, max: -1.5 })],
  ["normal, far upper tail", spec({ kind: "normal", mean: 0, stdDev: 1, min: 4, max: 5 })],
  ["lognormal, untruncated", spec({ kind: "lognormal", logMean: 0.5, logStdDev: 0.4 })],
  ["lognormal, truncated", spec({ kind: "lognormal", logMean: 0, logStdDev: 1, min: 0.5, max: 4 })],
];

describe("distributionQuantile", () => {
  it.each(SPECS)("is strictly increasing in u: %s", (_name, distribution) => {
    const us = [1e-6, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1 - 1e-6];
    const values = us.map((u) => distributionQuantile(distribution, u));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  it.each(SPECS)("stays inside the spec's support: %s", (_name, distribution) => {
    for (const u of [1e-9, 0.5, 1 - 1e-9]) {
      const value = distributionQuantile(distribution, u);
      expect(Number.isFinite(value)).toBe(true);
      if (distribution.kind !== "uniform") {
        if (distribution.min !== undefined) expect(value).toBeGreaterThanOrEqual(distribution.min);
        if (distribution.max !== undefined) expect(value).toBeLessThanOrEqual(distribution.max);
      }
      if (distribution.kind === "lognormal") expect(value).toBeGreaterThan(0);
    }
  });

  it("inverts the normal CDF against known standard-normal quantiles", () => {
    const standard = spec({ kind: "normal", mean: 0, stdDev: 1 });
    // Textbook values; 1e-9 is well inside the underlying quantile's accuracy.
    expect(distributionQuantile(standard, 0.5)).toBeCloseTo(0, 12);
    expect(distributionQuantile(standard, 0.975)).toBeCloseTo(1.959963984540054, 9);
    expect(distributionQuantile(standard, 0.95)).toBeCloseTo(1.6448536269514722, 9);
    expect(distributionQuantile(standard, 0.025)).toBeCloseTo(-1.959963984540054, 9);
  });

  it("places the median of a symmetric truncation at the centre", () => {
    const symmetric = spec({ kind: "normal", mean: 3, stdDev: 2, min: 1, max: 5 });
    expect(distributionQuantile(symmetric, 0.5)).toBeCloseTo(3, 10);
  });

  it("maps u to the fraction of mass below it, for a truncated normal", () => {
    // The defining property, checked against the analytic CDF rather than
    // against another implementation of the same idea.
    const distribution = spec({ kind: "normal", mean: 0, stdDev: 1, min: -1, max: 2 });
    const massAtAlpha = normalCdf(-1);
    const retained = normalCdf(2) - massAtAlpha;
    for (const u of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      const x = distributionQuantile(distribution, u);
      expect((normalCdf(x) - massAtAlpha) / retained).toBeCloseTo(u, 10);
    }
  });

  it("orients the entirely-negative interval the same way as every other spec", () => {
    // The reflection branch is the one place an off-by-orientation slip would
    // hide: it would still return values in [-3, -1] with the right law, just
    // transposed. Pinning it against the analytic CDF catches that.
    const distribution = spec({ kind: "normal", mean: 0, stdDev: 1, min: -3, max: -1 });
    const massAtAlpha = normalCdf(-3);
    const retained = normalCdf(-1) - massAtAlpha;
    for (const u of [0.1, 0.5, 0.9]) {
      const x = distributionQuantile(distribution, u);
      expect((normalCdf(x) - massAtAlpha) / retained).toBeCloseTo(u, 10);
    }
    expect(distributionQuantile(distribution, 0.1)).toBeLessThan(
      distributionQuantile(distribution, 0.9),
    );
  });

  it.each(SPECS)("agrees in distribution with sampleDistribution: %s", (_name, distribution) => {
    // The quantile is a different map from the draw -- Box-Muller has no u to
    // invert -- so they cannot agree pointwise. They must agree in law, which
    // is what makes the quantile a legitimate substitute inside a stratified
    // sampler. Compared on quartiles of 20000 draws.
    const rng = new PCG32(20260829n, 7n);
    const draws: number[] = [];
    for (let i = 0; i < 20000; i += 1) draws.push(sampleDistribution(distribution, rng));
    draws.sort((a, b) => a - b);
    for (const p of [0.25, 0.5, 0.75]) {
      const empirical = draws[Math.floor(p * draws.length)]!;
      const analytic = distributionQuantile(distribution, p);
      const scale = Math.max(1e-9, Math.abs(analytic));
      expect(Math.abs(empirical - analytic) / scale).toBeLessThan(0.05);
    }
  });

  it("rejects a u outside the open unit interval", () => {
    const standard = spec({ kind: "normal", mean: 0, stdDev: 1 });
    for (const bad of [0, 1, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => distributionQuantile(standard, bad)).toThrow(/probability in \(0, 1\)/);
    }
  });
});
