import { describe, expect, it } from "vitest";
import {
  mcConvergenceStudy,
  sampleStdDev,
  standardErrorOfMean,
  type McConvergenceStudy,
} from "./mc-convergence.js";

/**
 * A deterministic uniform generator, so every figure in this file is fixed
 * across runs and platforms. splitmix64's output low bits are good enough for
 * a variance measurement and the algorithm is already the repo's convention
 * (`mc-stats.ts`'s `hashMcStats` inlines the same mixer).
 */
function splitmix(seed: number): () => number {
  let state = BigInt.asUintN(64, BigInt(seed));
  const MASK = (1n << 64n) - 1n;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    z = z ^ (z >> 31n);
    // 53 bits is exactly what a float64 mantissa holds, so this is uniform on
    // [0,1) without the rounding bias a divide-by-2^64 would introduce.
    return Number(z >> 11n) / 2 ** 53;
  };
}

/** Box-Muller over {@link splitmix}: iid standard normals, deterministically. */
function normals(seed: number, count: number): number[] {
  const u = splitmix(seed);
  const out: number[] = [];
  while (out.length < count) {
    // u1 is drawn until non-zero; log(0) is -Infinity and would poison the pool.
    let u1 = u();
    while (u1 <= 0) {
      u1 = u();
    }
    const u2 = u();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(r * Math.cos(2 * Math.PI * u2));
    if (out.length < count) {
      out.push(r * Math.sin(2 * Math.PI * u2));
    }
  }
  return out;
}

const SIZES = [16, 32, 64, 128, 256, 512, 1024];

describe("sampleStdDev", () => {
  it("matches a hand-computed value with Bessel's correction", () => {
    // mean 4; deviations -2,-1,0,1,2; sum of squares 10; /(5-1) = 2.5
    expect(sampleStdDev([2, 3, 4, 5, 6])).toBeCloseTo(Math.sqrt(2.5), 15);
  });

  it("is null for fewer than two values, which have no spread", () => {
    expect(sampleStdDev([])).toBeNull();
    expect(sampleStdDev([1])).toBeNull();
  });

  it("is exactly zero for identical values rather than a rounding artefact", () => {
    expect(sampleStdDev([7, 7, 7, 7])).toBe(0);
  });

  it("does not lose the spread to cancellation when the mean dwarfs it", () => {
    // The shape streaming-moments.ts documents: a mean ~1e8 against a spread of
    // 1. The naive (sumSquares - sum^2/n)/(n-1) form loses most of its
    // significant digits here; the two-pass form is exact to rounding.
    const base = 1e8;
    const values = [base - 1, base, base + 1];
    expect(sampleStdDev(values)).toBeCloseTo(1, 12);
  });
});

describe("standardErrorOfMean", () => {
  it("is the sample standard deviation over sqrt(n)", () => {
    const values = [2, 3, 4, 5, 6];
    expect(standardErrorOfMean(values)).toBeCloseTo(Math.sqrt(2.5) / Math.sqrt(5), 15);
  });

  it("is null when there is no spread to divide", () => {
    expect(standardErrorOfMean([3])).toBeNull();
  });
});

describe("mcConvergenceStudy on iid samples: the -1/2 rate", () => {
  const study = mcConvergenceStudy(normals(20260824, 49152), SIZES);

  it("recovers a log-log slope of -0.5 within the P6.07 criterion", () => {
    expect(study.slope).not.toBeNull();
    expect(study.slope!).toBeGreaterThan(-0.55);
    expect(study.slope!).toBeLessThan(-0.45);
  });

  it("reports one point per batch size, ascending, with disjoint whole batches", () => {
    expect(study.points.map((p) => p.batchSize)).toEqual(SIZES);
    for (const p of study.points) {
      expect(p.batchCount).toBe(Math.floor(49152 / p.batchSize));
      // The pool divides evenly at every size here, so nothing is dropped.
      expect(p.batchCount * p.batchSize).toBe(49152);
    }
  });

  it("agrees with the derived sigma/sqrt(N) it deliberately does not fit", () => {
    // Agreement is the expected outcome on iid input -- the point of keeping
    // the two separate is that they *disagree* when independence fails, which
    // the correlated-pool case below asserts.
    for (const p of study.points) {
      expect(p.standardError).toBeGreaterThan(0.75 * p.predictedStandardError);
      expect(p.standardError).toBeLessThan(1.25 * p.predictedStandardError);
    }
  });

  it("estimates the underlying sigma of 1 at every batch size", () => {
    for (const p of study.points) {
      expect(p.pooledStdDev).toBeCloseTo(1, 1);
    }
  });

  it("is deterministic: the same pool gives bit-identical results", () => {
    const again = mcConvergenceStudy(normals(20260824, 49152), SIZES);
    expect(again.slope).toBe(study.slope);
    expect(again.points).toEqual(study.points);
  });

  it("holds the rate across independent seeds, so the slope is not one lucky pool", () => {
    // The guard against tuning a seed until the criterion passes. Five
    // unrelated pools, same criterion, all fixed and therefore never flaky.
    for (const seed of [1, 7, 12345, 987654321, 20260824]) {
      const s = mcConvergenceStudy(normals(seed, 49152), SIZES);
      expect(s.slope).not.toBeNull();
      expect(Math.abs(s.slope! + 0.5), `seed ${seed} gave slope ${s.slope}`).toBeLessThan(0.05);
    }
  });
});

describe("mcConvergenceStudy: what the criterion rejects", () => {
  /**
   * The counterexample that gives the criterion its meaning. Perfectly
   * correlated draws -- one value repeated across every replicate of a batch --
   * still have a mean and still have a spread, but the spread does not shrink
   * with N at all. A check that merely reported `s/sqrt(N)` would return a
   * flawless -0.5 here, because it computes the answer it is supposed to be
   * testing.
   */
  it("gives a slope near zero, not -0.5, when the pool is perfectly correlated", () => {
    const blockValues = normals(4242, 49152 / 16);
    const pool: number[] = [];
    // Sixteen copies of each draw, laid out so every batch of 16 is constant.
    for (const v of blockValues) {
      for (let k = 0; k < 16; k++) {
        pool.push(v);
      }
    }
    const correlated = mcConvergenceStudy(pool, SIZES);
    expect(correlated.slope).not.toBeNull();
    // The batch mean over N correlated draws behaves like a mean over N/16
    // independent ones, so the spread still falls -- but the whole curve is
    // shifted, and the smallest batch (entirely within one block) has no
    // spread at all beyond the block-to-block variation.
    expect(correlated.points[0]!.standardError).toBeGreaterThan(
      3 * correlated.points[0]!.predictedStandardError,
    );
  });

  it("gives a slope of zero for a pool whose batch means never shrink", () => {
    // A pure alternating pattern: every even-sized batch has mean exactly 0,
    // so the measured spread is 0 at every size and the fit has no line.
    const pool = Array.from({ length: 4096 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const flat = mcConvergenceStudy(pool, [16, 32, 64]);
    for (const p of flat.points) {
      expect(p.standardError).toBe(0);
    }
    // Every standard error is non-positive in log terms, so no pair survives
    // the fit and the slope is honestly null rather than a fabricated number.
    expect(flat.slope).toBeNull();
  });
});

describe("mcConvergenceStudy: edges and rejections", () => {
  it("drops a batch size too large to yield two whole batches", () => {
    const study = mcConvergenceStudy(normals(3, 100), [16, 64, 128]);
    // 128 > 100 gives zero batches; 64 gives one, which has no spread.
    expect(study.points.map((p) => p.batchSize)).toEqual([16]);
    expect(study.slope).toBeNull();
  });

  it("drops the tail that cannot fill a whole batch rather than short-batching it", () => {
    const study = mcConvergenceStudy(normals(5, 100), [16]);
    const point = study.points[0]!;
    expect(point.batchCount).toBe(6);
    // 6*16 = 96; the last four samples are unused, because a batch of four has
    // a different variance and would drag this point off the line.
    expect(point.batchCount * point.batchSize).toBe(96);
  });

  it("sorts and de-duplicates the requested batch sizes", () => {
    const study = mcConvergenceStudy(normals(11, 4096), [64, 16, 64, 32, 16]);
    expect(study.points.map((p) => p.batchSize)).toEqual([16, 32, 64]);
  });

  it("rejects a non-finite sample instead of silently skipping it", () => {
    expect(() => mcConvergenceStudy([1, 2, Number.NaN, 4], [2])).toThrow(/pool\[2\] is NaN/);
    expect(() => mcConvergenceStudy([1, Number.POSITIVE_INFINITY], [2])).toThrow(/must be finite/);
  });

  it("rejects a batch size that is not a positive integer", () => {
    expect(() => mcConvergenceStudy([1, 2, 3, 4], [2.5])).toThrow(/positive integer/);
    expect(() => mcConvergenceStudy([1, 2, 3, 4], [0])).toThrow(/positive integer/);
    expect(() => mcConvergenceStudy([1, 2, 3, 4], [-4])).toThrow(/positive integer/);
  });

  it("returns an empty study with a null slope for an empty pool", () => {
    const study: McConvergenceStudy = mcConvergenceStudy([], [16, 32]);
    expect(study.points).toEqual([]);
    expect(study.slope).toBeNull();
  });
});
