import { describe, expect, it } from "vitest";
import {
  MC_STATS_CROSS_PLATFORM_REL_TOL,
  assembleMcColumns,
  hashMcStats,
  mcStats,
  mcStatsRelativeDrift,
  type McChunk,
  type McObservableColumns,
  type McStats,
} from "./mc-stats.js";

/**
 * P6.05's contract is a shape, not a value: for any input, the reduction is
 * bit-identical to the same replicates reduced in canonical index order --
 * so a worker pool that finishes its chunks in any order at all produces the
 * same statistics and therefore the same hash. Every case below tests that
 * property against the same source data, permuted in the way one class of
 * fault would leave it.
 *
 * Numerical spot-checks are here too, but they are supporting: the point of
 * the file is that a shuffled chunk order does not change what comes out.
 *
 * Following the 46th/47th-run pattern (test the property, not the constants):
 * a couple of cases inject the two most plausible faults -- reducing during
 * assembly, and reducing right-to-left instead of left-to-right -- and
 * assert the hash notices them. A test that only compared numeric outputs
 * would miss a fault that changes bit patterns identically in every column.
 */

function makeSourceColumns(count: number): McObservableColumns {
  // Synthetic values chosen so per-observable sums are large enough for
  // rounding non-associativity to bite at the LSB when combined in different
  // orders. `0.1 * i + i * i * 1e-9` is unrepresentable exactly at every
  // step, so any pairwise sum on the fly disagrees with a full sequential
  // reduction at some bit; that is the fault this module exists to prevent.
  const range = new Float64Array(count);
  const apexHeight = new Float64Array(count);
  const timeOfFlight = new Float64Array(count);
  const impactSpeed = new Float64Array(count);
  const landed = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    range[i] = 100 + 0.1 * i + i * i * 1e-9;
    apexHeight[i] = 20 + 0.03 * i;
    timeOfFlight[i] = 4 + 0.001 * i;
    impactSpeed[i] = 30 - 0.002 * i;
    // Every seventeenth replicate does not land, so the landed subset is
    // meaningfully smaller than the count and non-landing exclusion has
    // something to catch.
    landed[i] = i % 17 === 0 ? 0 : 1;
  }
  return { range, apexHeight, timeOfFlight, impactSpeed, landed };
}

function sliceColumns(full: McObservableColumns, startIndex: number, endIndex: number): McChunk {
  return {
    startIndex,
    endIndex,
    columns: {
      range: full.range.slice(startIndex, endIndex),
      apexHeight: full.apexHeight.slice(startIndex, endIndex),
      timeOfFlight: full.timeOfFlight.slice(startIndex, endIndex),
      impactSpeed: full.impactSpeed.slice(startIndex, endIndex),
      landed: full.landed.slice(startIndex, endIndex),
    },
  };
}

function chunksFor(full: McObservableColumns, boundaries: readonly number[]): McChunk[] {
  const chunks: McChunk[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    chunks.push(sliceColumns(full, boundaries[i]!, boundaries[i + 1]!));
  }
  return chunks;
}

function equalColumns(a: McObservableColumns, b: McObservableColumns): boolean {
  if (a.range.length !== b.range.length) return false;
  for (let i = 0; i < a.range.length; i++) {
    if (!Object.is(a.range[i], b.range[i])) return false;
    if (!Object.is(a.apexHeight[i], b.apexHeight[i])) return false;
    if (!Object.is(a.timeOfFlight[i], b.timeOfFlight[i])) return false;
    if (!Object.is(a.impactSpeed[i], b.impactSpeed[i])) return false;
    if (a.landed[i] !== b.landed[i]) return false;
  }
  return true;
}

describe("assembleMcColumns", () => {
  it("places each chunk's data at its global start index regardless of arrival order", () => {
    const source = makeSourceColumns(64);
    const chunks = chunksFor(source, [0, 5, 17, 32, 63, 64]);

    // Same chunks, three different arrival orders: as-partitioned, reversed,
    // and interleaved. All three must assemble to the same full-length
    // buffer as the source.
    const asPartitioned = assembleMcColumns(chunks, 64);
    const reversed = assembleMcColumns([...chunks].reverse(), 64);
    const interleaved = assembleMcColumns(
      [chunks[3]!, chunks[0]!, chunks[4]!, chunks[1]!, chunks[2]!],
      64,
    );

    expect(equalColumns(asPartitioned, source)).toBe(true);
    expect(equalColumns(reversed, source)).toBe(true);
    expect(equalColumns(interleaved, source)).toBe(true);
  });

  it("rejects overlapping chunks", () => {
    const source = makeSourceColumns(10);
    const overlapping: McChunk[] = [sliceColumns(source, 0, 6), sliceColumns(source, 5, 10)];
    expect(() => assembleMcColumns(overlapping, 10)).toThrow(/more than one chunk/);
  });

  it("rejects gaps in coverage", () => {
    const source = makeSourceColumns(10);
    const gapped: McChunk[] = [sliceColumns(source, 0, 4), sliceColumns(source, 6, 10)];
    expect(() => assembleMcColumns(gapped, 10)).toThrow(/not covered by any chunk/);
  });

  it("rejects a chunk whose range extends past the batch total", () => {
    const source = makeSourceColumns(10);
    const oob: McChunk = sliceColumns(source, 0, 10);
    // Same width, different declared range that reaches beyond total.
    expect(() => assembleMcColumns([{ ...oob, startIndex: 5, endIndex: 15 }], 10)).toThrow(
      /not a subrange/,
    );
  });

  it("rejects a chunk whose column lengths disagree with its declared range", () => {
    const source = makeSourceColumns(10);
    const badWidth: McChunk = {
      startIndex: 0,
      endIndex: 5,
      columns: sliceColumns(source, 0, 6).columns,
    };
    expect(() => assembleMcColumns([badWidth], 10)).toThrow(/column length/);
  });

  it("handles the empty batch as a well-defined zero-length assembly", () => {
    const out = assembleMcColumns([], 0);
    expect(out.range.length).toBe(0);
    expect(out.landed.length).toBe(0);
  });
});

describe("mcStats", () => {
  it("counts landed and total replicates from the columns rather than a caller-supplied number", () => {
    const source = makeSourceColumns(100);
    const stats = mcStats(source);
    // Every 17th (0, 17, 34, 51, 68, 85) does not land -- so 6 non-landed
    // over 100 replicates.
    expect(stats.count).toBe(100);
    expect(stats.landedCount).toBe(94);
  });

  it("excludes non-landing replicates from every observable sum, sumSquares, min and max", () => {
    // A single non-landing replicate whose values are catastrophically bad
    // (large negatives) would move min and mean if it were counted; assert
    // it does not.
    const columns: McObservableColumns = {
      range: new Float64Array([100, 101, -1e9]),
      apexHeight: new Float64Array([20, 21, -1e9]),
      timeOfFlight: new Float64Array([4, 4.1, -1e9]),
      impactSpeed: new Float64Array([30, 29, -1e9]),
      landed: new Uint8Array([1, 1, 0]),
    };
    const stats = mcStats(columns);
    expect(stats.landedCount).toBe(2);
    // The poison value must not appear anywhere -- if it did, min would be
    // -1e9 rather than the smallest landed value.
    expect(stats.range.sum).toBe(201);
    expect(stats.range.min).toBe(100);
    expect(stats.range.max).toBe(101);
    expect(stats.range.sumSquares).toBe(100 * 100 + 101 * 101);
  });

  it("reports Infinity extremes and zero sums for a batch with no landed replicates", () => {
    const columns: McObservableColumns = {
      range: new Float64Array([1, 2, 3]),
      apexHeight: new Float64Array([1, 2, 3]),
      timeOfFlight: new Float64Array([1, 2, 3]),
      impactSpeed: new Float64Array([1, 2, 3]),
      landed: new Uint8Array([0, 0, 0]),
    };
    const stats = mcStats(columns);
    expect(stats.count).toBe(3);
    expect(stats.landedCount).toBe(0);
    expect(stats.range.sum).toBe(0);
    expect(stats.range.sumSquares).toBe(0);
    expect(stats.range.min).toBe(Number.POSITIVE_INFINITY);
    expect(stats.range.max).toBe(Number.NEGATIVE_INFINITY);
  });

  it("rejects a columns object whose lengths disagree", () => {
    const bad: McObservableColumns = {
      range: new Float64Array(5),
      apexHeight: new Float64Array(5),
      timeOfFlight: new Float64Array(4),
      impactSpeed: new Float64Array(5),
      landed: new Uint8Array(5),
    };
    expect(() => mcStats(bad)).toThrow(/column lengths do not agree/);
  });

  it("reports Welford mean and variance over the landed subset (P6.06)", () => {
    // Landed values 100, 101; the -1e9 is non-landing and must touch neither
    // mean nor variance, the same exclusion the sum test above pins.
    const columns: McObservableColumns = {
      range: new Float64Array([100, 101, -1e9]),
      apexHeight: new Float64Array([20, 22, -1e9]),
      timeOfFlight: new Float64Array([4, 4, -1e9]),
      impactSpeed: new Float64Array([30, 29, -1e9]),
      landed: new Uint8Array([1, 1, 0]),
    };
    const stats = mcStats(columns);
    // mean of {100, 101} = 100.5; sample variance = 0.5.
    expect(stats.range.mean).toBe(100.5);
    expect(stats.range.variance).toBe(0.5);
    // A constant landed column has exactly zero variance, not "close to".
    expect(stats.timeOfFlight.variance).toBe(0);
    expect(stats.timeOfFlight.mean).toBe(4);
  });

  it("mean and variance are NaN when the landed subset cannot support them", () => {
    const none: McObservableColumns = {
      range: new Float64Array([1, 2, 3]),
      apexHeight: new Float64Array([1, 2, 3]),
      timeOfFlight: new Float64Array([1, 2, 3]),
      impactSpeed: new Float64Array([1, 2, 3]),
      landed: new Uint8Array([0, 0, 0]),
    };
    const emptyStats = mcStats(none);
    // No landed replicate: mean has no value and variance has no meaning.
    // NaN, not 0 -- a zero mean would read as a centred batch.
    expect(emptyStats.range.mean).toBeNaN();
    expect(emptyStats.range.variance).toBeNaN();

    const single: McObservableColumns = {
      range: new Float64Array([42, 0]),
      apexHeight: new Float64Array([1, 0]),
      timeOfFlight: new Float64Array([1, 0]),
      impactSpeed: new Float64Array([1, 0]),
      landed: new Uint8Array([1, 0]),
    };
    const singleStats = mcStats(single);
    // One landed replicate has a mean but no spread.
    expect(singleStats.range.mean).toBe(42);
    expect(singleStats.range.variance).toBeNaN();
  });

  it("the Welford variance beats the sumSquares formula on a cancellation shape", () => {
    // The impact-speed shape: a mean far larger than the spread. mcStats keeps
    // sumSquares for the hash, but reading a variance off it cancels. The
    // stored `variance` field must be the stable one -- assert it agrees with
    // the two-pass reference far better than the sumSquares derivation does.
    const n = 2000;
    const range = new Float64Array(n);
    const apexHeight = new Float64Array(n);
    const timeOfFlight = new Float64Array(n);
    const impactSpeed = new Float64Array(n);
    const landed = new Uint8Array(n);
    // Deterministic spread around a large mean; 30 ± ~0.05, unrepresentable.
    for (let i = 0; i < n; i++) {
      const jitter = (((i * 2654435761) % 1000) / 1000 - 0.5) * 0.1;
      range[i] = 1850 + jitter;
      apexHeight[i] = 420 + jitter;
      timeOfFlight[i] = 4 + jitter;
      impactSpeed[i] = 30 + jitter;
      landed[i] = 1;
    }
    const stats = mcStats({ range, apexHeight, timeOfFlight, impactSpeed, landed });

    // Two-pass reference variance on impactSpeed.
    let sum = 0;
    for (let i = 0; i < n; i++) sum += impactSpeed[i]!;
    const mean = sum / n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (impactSpeed[i]! - mean) * (impactSpeed[i]! - mean);
    const twoPass = ss / (n - 1);

    const naive = (stats.impactSpeed.sumSquares - stats.impactSpeed.sum ** 2 / n) / (n - 1);
    const welfordError = Math.abs(stats.impactSpeed.variance - twoPass) / twoPass;
    const naiveError = Math.abs(naive - twoPass) / twoPass;
    expect(welfordError).toBeLessThan(1e-12);
    expect(naiveError).toBeGreaterThan(welfordError * 100);
  });

  it("hashMcStats covers the mean and variance fields", () => {
    // Two batches with identical sum/sumSquares/min/max but a different
    // variance are distinguished by the hash -- otherwise a reproducibility
    // check would silently stop guarding the new fields. Constructed by
    // reordering values so the naive sums match while the (order-sensitive)
    // Welford variance differs at the LSB is fragile; instead compare a real
    // batch against one with a perturbed variance field directly.
    const columns = makeSourceColumns(64);
    const base = mcStats(columns);
    const twisted: McStats = {
      ...base,
      range: { ...base.range, variance: base.range.variance * (1 + 1e-12) },
    };
    expect(hashMcStats(twisted)).not.toBe(hashMcStats(base));
  });
});

describe("hashMcStats", () => {
  it("is bit-identical for two batches whose chunk arrival orders differ", () => {
    const source = makeSourceColumns(256);
    const partitionA = [0, 32, 64, 96, 128, 160, 192, 224, 256];
    const partitionB = [0, 17, 33, 100, 199, 213, 256];

    // Partition A in one arrival order.
    const chunksA1 = chunksFor(source, partitionA);
    const shuffledA1 = [
      chunksA1[3]!,
      chunksA1[7]!,
      chunksA1[0]!,
      chunksA1[5]!,
      chunksA1[1]!,
      chunksA1[6]!,
      chunksA1[2]!,
      chunksA1[4]!,
    ];
    // Partition B in a different arrival order.
    const chunksB = chunksFor(source, partitionB);
    const shuffledB = [
      chunksB[2]!,
      chunksB[5]!,
      chunksB[0]!,
      chunksB[4]!,
      chunksB[1]!,
      chunksB[3]!,
    ];

    const hashA = hashMcStats(mcStats(assembleMcColumns(shuffledA1, 256)));
    const hashB = hashMcStats(mcStats(assembleMcColumns(shuffledB, 256)));
    const hashDirect = hashMcStats(mcStats(source));

    expect(hashA).toBe(hashDirect);
    expect(hashB).toBe(hashDirect);
  });

  it("changes when the reduction runs right-to-left instead of left-to-right (the fault the module exists to prevent)", () => {
    const source = makeSourceColumns(1024);
    const forward = hashMcStats(mcStats(source));

    // Reduce right-to-left by folding chunks of size 1 into the assembler in
    // reverse. Assembly still places each chunk at its global position, so
    // the *assembled* buffer is identical -- and therefore mcStats sees the
    // same buffer in the same order and produces the same hash. That means a
    // right-to-left assembly ORDER is not enough to change the output, which
    // is exactly the property P6.05 is here to guarantee.
    const singletons: McChunk[] = [];
    for (let i = 0; i < 1024; i++) singletons.push(sliceColumns(source, i, i + 1));
    const reversedAssembly = hashMcStats(
      mcStats(assembleMcColumns([...singletons].reverse(), 1024)),
    );
    expect(reversedAssembly).toBe(forward);

    // But if a caller reduces in reverse for real -- iterating the buffer
    // right-to-left -- the sum order changes and non-associativity moves the
    // low bit. Assert that the hash notices, so a future refactor cannot
    // silently switch reduction direction. Reproduces the reduction inline
    // rather than exposing a knob on `mcStats`.
    let sumForward = 0;
    let sumReverse = 0;
    for (let i = 0; i < 1024; i++) if (source.landed[i]) sumForward += source.range[i]!;
    for (let i = 1023; i >= 0; i--) if (source.landed[i]) sumReverse += source.range[i]!;
    expect(sumForward).not.toBe(sumReverse); // The non-associativity we rely on.

    const stats = mcStats(source);
    const twistedStats: McStats = {
      ...stats,
      range: { ...stats.range, sum: sumReverse },
    };
    expect(hashMcStats(twistedStats)).not.toBe(forward);
  });

  it("distinguishes count from landedCount (a swap would silently divide the mean wrong)", () => {
    // Two synthetic stats objects that differ only by the count/landedCount
    // labels; the hash must separate them because the estimator downstream
    // divides by landedCount.
    const base: McStats = {
      count: 100,
      landedCount: 94,
      range: { sum: 100, sumSquares: 200, min: 1, max: 2, mean: 50, variance: 2 },
      apexHeight: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
      timeOfFlight: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
      impactSpeed: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
    };
    const swapped: McStats = { ...base, count: 94, landedCount: 100 };
    expect(hashMcStats(base)).not.toBe(hashMcStats(swapped));
  });

  it("returns a 16-hex-digit 0x-prefixed string that round-trips through BigInt", () => {
    const source = makeSourceColumns(32);
    const h = hashMcStats(mcStats(source));
    expect(h).toMatch(/^0x[0-9a-f]{16}$/);
    // Round-trip: the string is a valid BigInt literal.
    expect(BigInt(h)).toBeGreaterThanOrEqual(0n);
  });

  it("collapses +0 and -0 to the same hash (they compare equal, so their stats should be indistinguishable)", () => {
    const withPos: McStats = {
      count: 1,
      landedCount: 1,
      range: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
      apexHeight: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
      timeOfFlight: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
      impactSpeed: { sum: 0, sumSquares: 0, min: 0, max: 0, mean: 0, variance: 0 },
    };
    const withNeg: McStats = {
      ...withPos,
      range: { sum: -0, sumSquares: -0, min: -0, max: -0, mean: -0, variance: -0 },
    };
    expect(hashMcStats(withPos)).toBe(hashMcStats(withNeg));
  });
});

/**
 * P6.27's cross-platform half. The same-platform half is bit-equality, which
 * `hashMcStats` already grades; this comparator exists only for the case
 * where bit-equality is unavailable by construction, and its whole value is
 * where it draws the line. A comparator that accepts everything would make
 * every future golden comparison vacuous, so each case below fixes one end of
 * the boundary rather than merely exercising the happy path.
 */
describe("mcStatsRelativeDrift (P6.27 cross-platform tolerance)", () => {
  const base = mcStats(makeSourceColumns(128));

  /** `stats` with one continuous field scaled by `1 + rel`. */
  function perturbed(rel: number): McStats {
    return {
      ...base,
      timeOfFlight: { ...base.timeOfFlight, sum: base.timeOfFlight.sum * (1 + rel) },
    };
  }

  it("is exactly zero for a batch against itself", () => {
    expect(mcStatsRelativeDrift(base, base)).toBe(0);
  });

  it("reports drift a hair under the §2.6 budget as passing, and a hair over as failing", () => {
    // The boundary is the whole point of the constant, so it is pinned from
    // both sides. 0.5x and 2x the budget rather than 1e-14/1e-12 so the two
    // cases stay adjacent to the number they grade if it is ever revised.
    const under = mcStatsRelativeDrift(base, perturbed(MC_STATS_CROSS_PLATFORM_REL_TOL * 0.5));
    const over = mcStatsRelativeDrift(base, perturbed(MC_STATS_CROSS_PLATFORM_REL_TOL * 2));
    expect(under).toBeLessThan(MC_STATS_CROSS_PLATFORM_REL_TOL);
    expect(over).toBeGreaterThan(MC_STATS_CROSS_PLATFORM_REL_TOL);
  });

  it("returns Infinity when the replicate counts differ at all", () => {
    // Not drift: two platforms ran different amounts of work. Scaling this
    // into a small relative number is the failure the guard exists to stop.
    expect(mcStatsRelativeDrift(base, { ...base, count: base.count + 1 })).toBe(Infinity);
  });

  it("returns Infinity when the landed counts differ, even with every continuous field identical", () => {
    // The likelier cross-engine disagreement of the two: one engine's event
    // localization puts a marginal replicate on the ground and the other's
    // does not. Every sum can still match to the bit while the answer differs.
    expect(mcStatsRelativeDrift(base, { ...base, landedCount: base.landedCount - 1 })).toBe(
      Infinity,
    );
  });

  it("treats two NaN means as agreement rather than as infinite drift", () => {
    // An all-non-landing batch has a NaN mean by design. Two platforms that
    // both report "no answer" have not drifted, and `NaN !== NaN` would say
    // they had.
    const empty = mcStats({
      range: new Float64Array(4),
      apexHeight: new Float64Array(4),
      timeOfFlight: new Float64Array(4),
      impactSpeed: new Float64Array(4),
      landed: new Uint8Array(4),
    });
    expect(Number.isNaN(empty.range.mean)).toBe(true);
    expect(mcStatsRelativeDrift(empty, empty)).toBe(0);
    // ...but a NaN against a real number is not agreement.
    const half: McStats = { ...empty, range: { ...empty.range, mean: 0 } };
    expect(mcStatsRelativeDrift(empty, half)).toBe(Infinity);
  });

  it("covers every continuous field, so none can silently stop being guarded", () => {
    // Mirrors hashMcStats's own "covers mean and variance" case: perturb each
    // field of each observable in turn and require the comparator to notice.
    const observables = ["range", "apexHeight", "timeOfFlight", "impactSpeed"] as const;
    const fields = ["sum", "sumSquares", "min", "max", "mean", "variance"] as const;
    for (const observable of observables) {
      for (const field of fields) {
        const twisted: McStats = {
          ...base,
          [observable]: { ...base[observable], [field]: base[observable][field] * 1.5 },
        };
        expect(
          mcStatsRelativeDrift(base, twisted),
          `${observable}.${field} is not covered by mcStatsRelativeDrift`,
        ).toBeGreaterThan(MC_STATS_CROSS_PLATFORM_REL_TOL);
      }
    }
  });
});
