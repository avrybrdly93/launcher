import { PCG32 } from "@ballista/engine";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HIT_PROBABILITY_LEVEL,
  formatHitProbability,
  hitProbability,
  wilsonInterval,
} from "./hit-probability.js";
import type { RingTarget } from "./targets.js";

/**
 * Draw `k ~ Binomial(n, p)` by counting `n` Bernoulli trials.
 *
 * Deliberately the naive sum rather than an inversion or BTPE sampler: this is
 * the *reference* the estimator is checked against, so it is written to be
 * obviously correct rather than fast. `n` here is at most a few hundred.
 */
function binomialSample(rng: PCG32, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (rng.nextF64() < p) k += 1;
  return k;
}

describe("wilsonInterval", () => {
  // Reference values below are from an independent evaluation of the Wilson
  // score formula at z = Phi^-1(0.975) = 1.9599639845400536, computed outside
  // this codebase and quoted to 10 decimals. They are asserted to 8 rather than
  // to `toBeCloseTo`'s loose default because a half-width off by a constant
  // factor -- the realistic implementation error -- moves these digits.
  it("matches an independent evaluation for 0 successes in 20 trials", () => {
    // The textbook case for why Wald is unusable here.
    const ci = wilsonInterval(0, 20, 0.95);
    expect(ci.pHat).toBe(0);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBeCloseTo(0.1611251581, 8);
    expect(ci.center).toBeCloseTo(0.080562579, 8);
  });

  it("matches an independent evaluation for 7 successes in 20 trials", () => {
    const ci = wilsonInterval(7, 20, 0.95);
    expect(ci.pHat).toBeCloseTo(0.35, 12);
    expect(ci.lower).toBeCloseTo(0.1811918241, 8);
    expect(ci.upper).toBeCloseTo(0.5671457233, 8);
    expect(ci.center).toBeCloseTo(0.3741687737, 8);
  });

  it("matches an independent evaluation for 20 successes in 20 trials", () => {
    const ci = wilsonInterval(20, 20, 0.95);
    expect(ci.lower).toBeCloseTo(0.8388748419, 8);
    expect(ci.upper).toBe(1);
  });

  it("returns its endpoints exactly, not one ulp short of them", () => {
    // `center + halfWidth` at k = n rounds to 0.9999999999999999; the exact sum
    // is denom/denom = 1. Asserted with toBe, since the point is exactness.
    for (const n of [1, 5, 20, 137, 5000]) {
      expect(wilsonInterval(0, n, 0.95).lower).toBe(0);
      expect(wilsonInterval(n, n, 0.95).upper).toBe(1);
    }
    // And the far bound is still strictly interior -- an exact endpoint must
    // not have been bought by collapsing the interval.
    expect(wilsonInterval(0, 20, 0.95).upper).toBeGreaterThan(0);
    expect(wilsonInterval(20, 20, 0.95).lower).toBeLessThan(1);
  });

  it("has non-zero width at both endpoints, which is the whole reason it is not Wald", () => {
    for (const [k, n] of [
      [0, 20],
      [20, 20],
      [0, 1],
      [1, 1],
    ] as const) {
      const ci = wilsonInterval(k, n, 0.95);
      expect(ci.upper - ci.lower).toBeGreaterThan(0);
      // The Wald half-width at these counts is exactly zero.
      const wald = 1.959963985 * Math.sqrt(((k / n) * (1 - k / n)) / n);
      expect(wald).toBe(0);
    }
  });

  it("keeps both bounds inside [0, 1] for every count at n = 1..40", () => {
    for (let n = 1; n <= 40; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const ci = wilsonInterval(k, n, 0.99);
        expect(ci.lower).toBeGreaterThanOrEqual(0);
        expect(ci.upper).toBeLessThanOrEqual(1);
        expect(ci.lower).toBeLessThanOrEqual(ci.upper);
      }
    }
  });

  it("brackets pHat, but is not centred on it away from k/n = 1/2", () => {
    const ci = wilsonInterval(1, 30, 0.95);
    expect(ci.lower).toBeLessThanOrEqual(ci.pHat);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.pHat);
    // Shrunk toward 1/2: the centre sits strictly above pHat when pHat < 1/2.
    expect(ci.center).toBeGreaterThan(ci.pHat);
    const midpoint = (ci.lower + ci.upper) / 2;
    expect(Math.abs(midpoint - ci.pHat)).toBeGreaterThan(0.01);
  });

  it("is exactly symmetric about 1/2 under k -> n - k", () => {
    const a = wilsonInterval(3, 17, 0.95);
    const b = wilsonInterval(14, 17, 0.95);
    expect(a.lower).toBeCloseTo(1 - b.upper, 15);
    expect(a.upper).toBeCloseTo(1 - b.lower, 15);
  });

  it("narrows monotonically as n grows at fixed pHat", () => {
    let previous = Infinity;
    for (const n of [10, 20, 40, 80, 160, 320]) {
      const ci = wilsonInterval(n / 2, n, 0.95);
      const width = ci.upper - ci.lower;
      expect(width).toBeLessThan(previous);
      previous = width;
    }
  });

  it("widens as the confidence level rises", () => {
    const w = (level: number): number => {
      const ci = wilsonInterval(8, 25, level);
      return ci.upper - ci.lower;
    };
    expect(w(0.8)).toBeLessThan(w(0.95));
    expect(w(0.95)).toBeLessThan(w(0.99));
  });

  it("rejects malformed counts and levels rather than returning a plausible number", () => {
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(2.5, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(0, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(0, -3)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 10, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 10, 1)).toThrow(RangeError);
  });
});

describe("wilsonInterval against a binomial simulation (P6.11's criterion)", () => {
  /**
   * Coverage: over many binomial samples at a known `p`, the fraction of Wilson
   * intervals containing that `p` should be close to the nominal level.
   *
   * This is the criterion "matches binomial simulation on constructed case",
   * and it is the only test here that could catch a wrong z, a wrong
   * denominator, or a half-width off by a factor — every algebraic mistake
   * shows up as coverage that is not the nominal value. Seeded, so it is
   * deterministic; the tolerances below are wide enough for the sampling noise
   * at these trial counts and narrow enough that Wald would fail them.
   */
  const REPLICATES = 4000;

  for (const { n, p } of [
    { n: 25, p: 0.5 },
    { n: 25, p: 0.2 },
    { n: 40, p: 0.05 },
    { n: 100, p: 0.9 },
  ]) {
    it(`covers p = ${p} at about 95% over ${REPLICATES} samples of n = ${n}`, () => {
      const rng = new PCG32(0xba11_1541n, BigInt(Math.round(1000 * p) + n));
      let covered = 0;
      for (let r = 0; r < REPLICATES; r += 1) {
        const k = binomialSample(rng, n, p);
        const ci = wilsonInterval(k, n, 0.95);
        if (ci.lower <= p && p <= ci.upper) covered += 1;
      }
      const coverage = covered / REPLICATES;
      // Wilson is conservative in places (its coverage oscillates above and
      // below nominal with n and p), so the band is one-sided-generous upward
      // but will not tolerate the under-coverage a wrong constant produces.
      expect(coverage).toBeGreaterThan(0.9);
      expect(coverage).toBeLessThanOrEqual(1);
    });
  }

  it("beats Wald's coverage at a small p, which is the case that motivated the choice", () => {
    const n = 40;
    const p = 0.05;
    const rng = new PCG32(0xba11_1541n, 77n);
    let wilsonCovered = 0;
    let waldCovered = 0;
    for (let r = 0; r < REPLICATES; r += 1) {
      const k = binomialSample(rng, n, p);
      const ci = wilsonInterval(k, n, 0.95);
      if (ci.lower <= p && p <= ci.upper) wilsonCovered += 1;

      const pHat = k / n;
      const half = 1.959963985 * Math.sqrt((pHat * (1 - pHat)) / n);
      if (pHat - half <= p && p <= pHat + half) waldCovered += 1;
    }
    // Measured, not assumed: Wald's interval is empty of p whenever k = 0,
    // which at p = 0.05, n = 40 happens about 13% of the time.
    expect(waldCovered / REPLICATES).toBeLessThan(0.9);
    expect(wilsonCovered / REPLICATES).toBeGreaterThan(waldCovered / REPLICATES);
  });

  it("the empirical hit rate converges to p, so the estimator itself is unbiased", () => {
    const rng = new PCG32(0x5eed_5eedn, 3n);
    const n = 200;
    const p = 0.37;
    let total = 0;
    const rounds = 300;
    for (let r = 0; r < rounds; r += 1) total += binomialSample(rng, n, p) / n;
    expect(total / rounds).toBeCloseTo(p, 2);
  });
});

describe("hitProbability", () => {
  /** A 10 m-radius disc on the ground at 100 m downrange, in the planar layout. */
  const ring: RingTarget = {
    kind: "ring",
    center: [100, 0],
    radius: 10,
    tolerance: 0,
  };

  it("counts a constructed ensemble exactly, so p-hat is the hit fraction", () => {
    // 3 inside the disc, 2 outside. No randomness: this pins the counting.
    const impacts = [
      [100, 0],
      [95, 0],
      [109.9, 0],
      [111, 0],
      [80, 0],
    ];
    const hp = hitProbability(impacts, ring);
    expect(hp.hits).toBe(3);
    expect(hp.shots).toBe(5);
    expect(hp.pHat).toBeCloseTo(0.6, 12);
    expect(hp.level).toBe(DEFAULT_HIT_PROBABILITY_LEVEL);
  });

  it("agrees exactly with wilsonInterval on the same counts", () => {
    const impacts = Array.from({ length: 30 }, (_, i) => [i < 11 ? 100 : 500, 0]);
    const hp = hitProbability(impacts, ring, { level: 0.9 });
    const ci = wilsonInterval(11, 30, 0.9);
    expect(hp.lower).toBe(ci.lower);
    expect(hp.upper).toBe(ci.upper);
    expect(hp.center).toBe(ci.center);
  });

  it("recovers a known hit probability from a simulated dispersion", () => {
    // Impacts scattered N(100, 8) downrange against the 10 m disc at 100 m, so
    // the true hit probability is P(|X - 100| <= 10) = 2*Phi(10/8) - 1.
    const rng = new PCG32(0xd15_9a17n, 11n);
    const sigma = 8;
    const shots = 3000;
    const impacts = Array.from({ length: shots }, () => [100 + sigma * rng.nextGaussian(), 0]);
    const hp = hitProbability(impacts, ring);

    // 2*Phi(1.25) - 1, to five figures.
    const truth = 0.7887;
    expect(hp.pHat).toBeCloseTo(truth, 2);
    expect(hp.lower).toBeLessThanOrEqual(truth);
    expect(hp.upper).toBeGreaterThanOrEqual(truth);
  });

  it("honours the target's tolerance rather than defining its own hit test", () => {
    const strict = hitProbability([[112, 0]], ring);
    expect(strict.hits).toBe(0);
    const lenient = hitProbability([[112, 0]], { ...ring, tolerance: 5 });
    expect(lenient.hits).toBe(1);
  });

  it("throws on a NaN impact instead of silently recording it as a miss", () => {
    expect(() =>
      hitProbability(
        [
          [100, 0],
          [Number.NaN, 0],
        ],
        ring,
      ),
    ).toThrow(/NaN/);
  });

  it("throws on an empty ensemble", () => {
    expect(() => hitProbability([], ring)).toThrow(RangeError);
  });

  it("formats the estimate, the interval and n together", () => {
    const hp = hitProbability(
      Array.from({ length: 20 }, (_, i) => [i < 7 ? 100 : 500, 0]),
      ring,
    );
    expect(formatHitProbability(hp)).toBe("35.0% [18.1%, 56.7%] at 95% (7/20)");
  });
});
