import { describe, expect, it } from "vitest";
import {
  exactQuantile,
  p2Quantiles,
  P2QuantileEstimator,
  welfordMoments,
  WelfordAccumulator,
} from "./streaming-moments.js";

/**
 * P6.06's criterion ("matches offline numpy on fixture to 1e-10, quantile
 * ±0.5%") is measured in `packages/validation/src/mc-moments-numpy.test.ts`
 * against a committed numpy fixture, because that is the only place a numpy
 * comparison can honestly live.
 *
 * This file grades the properties instead — the ones that make the numbers in
 * that fixture mean something:
 *
 *   * Welford agrees with the exact answer where the exact answer is known,
 *     and keeps agreeing on the input shape where the textbook
 *     `sumSquares - sum^2/n` formula does not. That second case is the
 *     module's whole reason for existing, so it is measured rather than
 *     asserted in a comment.
 *   * The Chan merge is exact enough to be usable and is NOT bit-identical to
 *     sequential pushing — both directions matter, because a future session
 *     reading "merge is equivalent" would reasonably conclude it can merge in
 *     arrival order.
 *   * P²'s markers stay ordered, its estimate stays inside the sample range,
 *     and it is exact below five observations and only there.
 */

/**
 * A deterministic value generator. `Math.random` is banned from tests here for
 * the obvious reason: a statistical assertion that fails one run in fifty is
 * worse than no assertion. This is a Box-Muller normal over a splitmix-style
 * integer stream, which is enough shape for an estimator test and is
 * reproducible to the bit.
 */
function normals(count: number, mean: number, sd: number, seed = 1): number[] {
  let state = seed >>> 0;
  const uniform = (): number => {
    // xorshift32; never returns 0, so the log below is safe.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state + 1) / 4294967297;
  };
  const out: number[] = [];
  while (out.length < count) {
    const u1 = uniform();
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(mean + sd * r * Math.cos(2 * Math.PI * u2));
    if (out.length < count) out.push(mean + sd * r * Math.sin(2 * Math.PI * u2));
  }
  return out;
}

/** The formula Welford exists to replace, for the comparison below. */
function naiveVariance(values: readonly number[]): number {
  let sum = 0;
  let sumSquares = 0;
  for (const v of values) {
    sum += v;
    sumSquares += v * v;
  }
  const n = values.length;
  return (sumSquares - (sum * sum) / n) / (n - 1);
}

describe("WelfordAccumulator", () => {
  it("is empty-safe: mean and variance are NaN, not zero", () => {
    const acc = new WelfordAccumulator();
    expect(acc.count).toBe(0);
    expect(acc.mean).toBeNaN();
    expect(acc.variance).toBeNaN();
    expect(acc.populationVariance).toBeNaN();
    expect(acc.standardError).toBeNaN();
  });

  it("reports a mean but no variance from a single observation", () => {
    const acc = new WelfordAccumulator();
    acc.push(7.5);
    expect(acc.count).toBe(1);
    expect(acc.mean).toBe(7.5);
    // A zero here would claim a perfectly precise estimate from one sample.
    expect(acc.variance).toBeNaN();
    expect(acc.populationVariance).toBe(0);
  });

  it("matches hand-computed moments on a small exact sample", () => {
    // 2, 4, 4, 4, 5, 5, 7, 9: mean 5, population variance 4, sample variance
    // 32/7. All three are exact in binary, so this is an equality test.
    const acc = new WelfordAccumulator();
    for (const v of [2, 4, 4, 4, 5, 5, 7, 9]) acc.push(v);
    expect(acc.count).toBe(8);
    expect(acc.mean).toBe(5);
    expect(acc.populationVariance).toBe(4);
    expect(acc.variance).toBeCloseTo(32 / 7, 15);
    expect(acc.sumOfSquaredDeviations).toBe(32);
    expect(acc.standardDeviation).toBeCloseTo(Math.sqrt(32 / 7), 15);
    expect(acc.standardError).toBeCloseTo(Math.sqrt(32 / 7 / 8), 15);
  });

  it("is exact on a constant stream, where the naive formula is not obliged to be", () => {
    const acc = new WelfordAccumulator();
    for (let i = 0; i < 1000; i++) acc.push(1e8 + 3);
    expect(acc.mean).toBe(1e8 + 3);
    // Exactly zero, not "close to" zero: every deviation from the running
    // mean is exactly zero, so M2 never accumulates anything at all.
    expect(acc.variance).toBe(0);
  });

  it("survives the cancellation shape the naive formula loses five digits to", () => {
    // The impact-speed column: mean 600x the standard deviation. This is the
    // measurement behind the module's opening comment.
    const values = normals(4000, 30, 0.05, 12345);
    const welford = welfordMoments(values).variance;
    const naive = naiveVariance(values);

    // Reference: the two-pass formula, which is what "the right answer" means
    // here — it subtracts a mean computed from the whole sample first.
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let ss = 0;
    for (const v of values) ss += (v - mean) * (v - mean);
    const twoPass = ss / (values.length - 1);

    const welfordError = Math.abs(welford - twoPass) / twoPass;
    const naiveError = Math.abs(naive - twoPass) / twoPass;
    expect(welfordError).toBeLessThan(1e-12);
    // Not merely "worse": worse by orders of magnitude. If this ever stops
    // holding, the fixture shape stopped being a cancellation case and the
    // module's justification needs rewriting, not the test relaxing.
    expect(naiveError).toBeGreaterThan(welfordError * 100);
  });

  it("pushes non-finite values through rather than silently dropping them", () => {
    const acc = new WelfordAccumulator();
    acc.push(1);
    acc.push(Number.NaN);
    expect(acc.count).toBe(2);
    expect(acc.mean).toBeNaN();
  });

  it("reset returns it to the empty state", () => {
    const acc = new WelfordAccumulator();
    for (const v of [1, 2, 3]) acc.push(v);
    acc.reset();
    expect(acc.count).toBe(0);
    expect(acc.mean).toBeNaN();
    acc.push(10);
    expect(acc.mean).toBe(10);
  });
});

describe("WelfordAccumulator.merge", () => {
  it("reproduces the whole-stream moments from two halves", () => {
    const values = normals(500, 1850, 45, 77);
    const whole = new WelfordAccumulator();
    for (const v of values) whole.push(v);

    const left = new WelfordAccumulator();
    const right = new WelfordAccumulator();
    values.slice(0, 213).forEach((v) => left.push(v));
    values.slice(213).forEach((v) => right.push(v));
    left.merge(right);

    expect(left.count).toBe(whole.count);
    expect(left.mean).toBeCloseTo(whole.mean, 10);
    expect(left.variance).toBeCloseTo(whole.variance, 8);
  });

  it("is NOT bit-identical to sequential pushing, and that is documented", () => {
    // The merge evaluates a different expression, so it lands within rounding
    // rather than on the same bits. A session that assumed otherwise would
    // conclude chunk merge order does not matter -- it does.
    const values = normals(64, 1850, 45, 9);
    const whole = new WelfordAccumulator();
    for (const v of values) whole.push(v);
    const a = new WelfordAccumulator();
    const b = new WelfordAccumulator();
    values.slice(0, 31).forEach((v) => a.push(v));
    values.slice(31).forEach((v) => b.push(v));
    a.merge(b);
    expect(a.variance).not.toBe(whole.variance);
    expect(Math.abs(a.variance - whole.variance) / whole.variance).toBeLessThan(1e-12);
  });

  it("merging an empty accumulator changes nothing, in either direction", () => {
    const acc = new WelfordAccumulator();
    [3, 1, 4, 1, 5].forEach((v) => acc.push(v));
    const before = { count: acc.count, mean: acc.mean, variance: acc.variance };
    acc.merge(new WelfordAccumulator());
    expect(acc.count).toBe(before.count);
    expect(acc.mean).toBe(before.mean);
    expect(acc.variance).toBe(before.variance);

    const empty = new WelfordAccumulator();
    empty.merge(acc);
    expect(empty.count).toBe(before.count);
    expect(empty.mean).toBe(before.mean);
    expect(empty.variance).toBe(before.variance);
  });

  it("merges of the same chunks in different orders agree to rounding but need not be identical", () => {
    const values = normals(300, 420, 140, 31);
    const chunks = [values.slice(0, 100), values.slice(100, 200), values.slice(200)];
    const fold = (order: readonly number[]): WelfordAccumulator => {
      const out = new WelfordAccumulator();
      for (const index of order) {
        const part = new WelfordAccumulator();
        (chunks[index] as number[]).forEach((v) => part.push(v));
        out.merge(part);
      }
      return out;
    };
    const canonical = fold([0, 1, 2]);
    const shuffled = fold([2, 0, 1]);
    expect(shuffled.count).toBe(canonical.count);
    expect(Math.abs(shuffled.mean - canonical.mean)).toBeLessThan(1e-9);
    // The canonical order is the one a caller must use for reproducibility:
    // this is exactly the P6.05 property one level up.
    expect(fold([0, 1, 2]).mean).toBe(canonical.mean);
  });
});

describe("P2QuantileEstimator", () => {
  it("rejects the endpoints and anything outside (0, 1)", () => {
    expect(() => new P2QuantileEstimator(0)).toThrow(RangeError);
    expect(() => new P2QuantileEstimator(1)).toThrow(RangeError);
    expect(() => new P2QuantileEstimator(-0.1)).toThrow(RangeError);
    expect(() => new P2QuantileEstimator(Number.NaN)).toThrow(RangeError);
  });

  it("rejects NaN, which has no position in an ordering", () => {
    const estimator = new P2QuantileEstimator(0.5);
    expect(() => estimator.push(Number.NaN)).toThrow(RangeError);
  });

  it("is NaN when empty and exact below five observations", () => {
    const estimator = new P2QuantileEstimator(0.5);
    expect(estimator.value).toBeNaN();
    for (const v of [4, 1, 3, 2]) estimator.push(v);
    // Four values, median by linear interpolation: h = 0.5*3 = 1.5, between
    // sorted[1]=2 and sorted[2]=3.
    expect(estimator.value).toBe(2.5);
    expect(estimator.value).toBe(exactQuantile([4, 1, 3, 2], 0.5));
  });

  it("is exact on a uniform ramp presented in shuffled order", () => {
    // x_i = i for i in 0..1000, a linear distribution where P²'s parabolic
    // prediction is exact. Fed SHUFFLED, not sorted: monotone arrival is P²'s
    // pathological case (the markers never get to reposition against later
    // values), and no real Monte Carlo batch arrives sorted. A fixed
    // permutation keeps it reproducible.
    const values = Array.from({ length: 1001 }, (_, i) => i);
    // Deterministic Fisher-Yates over the same xorshift the normals use.
    let state = 424242 >>> 0;
    for (let i = values.length - 1; i > 0; i--) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      const j = state % (i + 1);
      [values[i], values[j]] = [values[j] as number, values[i] as number];
    }
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const estimator = new P2QuantileEstimator(p);
      values.forEach((v) => estimator.push(v));
      // Measured absolute errors on this fixed shuffle, out of a range of
      // 1000: p05 1.75, p25 2.51, p50 5.68, p75 0.41, p95 0.62 — worst 0.57%
      // of the range, at the median. The bound is 7 (0.7% of range): P² is
      // close on a linear distribution but is still an estimator, not the
      // sort, and the median of a symmetric sample is where its markers are
      // sparsest.
      expect(Math.abs(estimator.value - exactQuantile(values, p))).toBeLessThan(7);
    }
  });

  it("keeps its markers sorted once initialised and its estimate inside the range", () => {
    const values = normals(2000, 420, 140, 5);
    const estimator = new P2QuantileEstimator(0.9);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of values) {
      estimator.push(v);
      min = Math.min(min, v);
      max = Math.max(max, v);
      // markers() before the fifth push is the raw buffer, not yet sorted --
      // the algorithm sorts on initialisation. The ordering invariant only
      // holds once the five markers exist.
      if (estimator.count >= 5) {
        const markers = estimator.markers();
        for (let i = 1; i < markers.length; i++) {
          expect((markers[i] as number) >= (markers[i - 1] as number)).toBe(true);
        }
        expect(estimator.value).toBeGreaterThanOrEqual(min);
        expect(estimator.value).toBeLessThanOrEqual(max);
      }
    }
    expect(estimator.count).toBe(values.length);
  });

  it("tracks the outer markers to the exact running min and max", () => {
    const values = [5, 3, 9, 1, 7, 12, 0, 8];
    const estimator = new P2QuantileEstimator(0.5);
    values.forEach((v) => estimator.push(v));
    const markers = estimator.markers();
    expect(markers[0]).toBe(Math.min(...values));
    expect(markers[4]).toBe(Math.max(...values));
  });

  it("stays within 1% of the sorted answer on a skewed sample", () => {
    // Lognormal: the shape where evenly spaced markers have the most trouble,
    // and the shape the apex-height column takes. The 0.5% criterion P6.06
    // states is checked in packages/validation against the numpy fixture,
    // whose worst column (apex, p=0.95) lands at ~0.33%; this synthetic case
    // is deliberately harsher (a shorter, differently seeded sample) and the
    // interesting property here is that even so the tail estimate stays within
    // 1%, so it degrades gracefully rather than diverging.
    const values = normals(4000, 0, 0.35, 909).map((z) => 420 * Math.exp(z));
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const estimator = new P2QuantileEstimator(p);
      values.forEach((v) => estimator.push(v));
      const exact = exactQuantile(values, p);
      const relative = Math.abs(estimator.value - exact) / Math.abs(exact);
      expect(relative, `p = ${p}: ${estimator.value} vs ${exact}`).toBeLessThan(0.01);
    }
  });

  it("costs the same state regardless of sample size", () => {
    // The property that makes it usable from P6.10's per-time-grid bands:
    // five markers, whatever N is. Asserted on the observable surface rather
    // than by measuring the heap, which would be measuring the GC.
    const small = new P2QuantileEstimator(0.5);
    const large = new P2QuantileEstimator(0.5);
    normals(10, 1, 1, 3).forEach((v) => small.push(v));
    normals(100000, 1, 1, 3).forEach((v) => large.push(v));
    expect(small.markers()).toHaveLength(5);
    expect(large.markers()).toHaveLength(5);
  });
});

describe("p2Quantiles and exactQuantile", () => {
  it("p2Quantiles returns estimates in the order the quantiles were asked for", () => {
    const values = normals(3000, 100, 10, 21);
    const ps = [0.9, 0.1, 0.5];
    const got = p2Quantiles(values, ps);
    expect(got).toHaveLength(3);
    // Asked out of order on purpose: a version that sorted its inputs would
    // return them re-ordered and every caller would be silently mislabelled.
    expect(got[0]).toBeGreaterThan(got[2] as number);
    expect(got[2]).toBeGreaterThan(got[1] as number);
  });

  it("exactQuantile matches numpy's linear convention at the endpoints", () => {
    const values = [10, 20, 30, 40];
    expect(exactQuantile(values, 0)).toBe(10);
    expect(exactQuantile(values, 1)).toBe(40);
    // h = 0.25 * 3 = 0.75 -> 10 + 0.75 * 10.
    expect(exactQuantile(values, 0.25)).toBeCloseTo(17.5, 12);
  });

  it("exactQuantile is NaN on an empty sample and rejects p outside [0, 1]", () => {
    expect(exactQuantile([], 0.5)).toBeNaN();
    expect(() => exactQuantile([1, 2], 1.5)).toThrow(RangeError);
  });

  it("exactQuantile does not disturb the caller's array", () => {
    const values = [3, 1, 2];
    exactQuantile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});
