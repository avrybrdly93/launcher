/**
 * Deterministic reduction of a Monte Carlo batch's per-replicate observables
 * into per-column statistics (P6.05).
 *
 * **The property is order.** IEEE-754 addition is not associative, so
 * `((a + b) + c)` is not, in general, bit-identical to `((b + c) + a)`. A
 * worker pool completes chunks in whatever order the OS scheduled them; a
 * mean built from those chunks in arrival order therefore differs from run to
 * run at the LSB, and any downstream check that hashes the numeric output
 * (P6.27's reproducibility test in particular) reports drift where there was
 * only scheduling jitter. P6.05's fix is to reduce in **canonical replicate
 * order** (index 0, 1, ..., N-1) regardless of the order chunks arrived, and
 * to expose {@link hashMcStats} so the property is checkable at the value
 * level rather than merely asserted.
 *
 * The reduction pipeline is two steps:
 * 1. {@link assembleMcColumns} takes an unordered list of `{startIndex,
 *    endIndex, columns}` chunks and writes each chunk's data into a
 *    full-length buffer at its global position -- so the fully populated
 *    buffer is byte-identical regardless of the order chunks were handed to
 *    the assembler.
 * 2. {@link mcStats} walks that buffer once, from index 0 up, folding each
 *    landed replicate's value into the running per-observable sum/sumSquares
 *    and min/max in that fixed order. A non-landing replicate contributes to
 *    the count but to nothing else (`mc-job.ts`'s `landed` doc: a truncated
 *    flight's "impact" is wherever it happened to be at the horizon, and
 *    averaging that in with real impacts silently biases the estimator by an
 *    amount nothing in the output shows).
 *
 * **Mean and variance are computed with Welford, in this same loop (P6.06).**
 * `sum`/`sumSquares` are kept as the order-sensitive reduction primitives and
 * as what {@link hashMcStats} folds; `mean` and `variance` are folded in
 * beside them by a {@link WelfordAccumulator} per observable, because the
 * one-line `(sumSquares - sum^2/n)/(n-1)` derivation catastrophically cancels
 * on the shapes this project's observables take (an impact-speed column with a
 * mean 600x its spread loses five leading digits before the subtraction
 * begins). See `streaming-moments.ts` for the argument and the measurement.
 *
 * Structural typing on the columns is what keeps analysis free of a
 * runtime-package import (that would be a dependency cycle -- runtime already
 * imports {@link ObservableSink} from analysis). The exported
 * {@link McObservableColumns} shape matches `runtime/mc-job.ts`'s `McColumns`
 * one-for-one so its buffers can be passed in unchanged.
 */

import { WelfordAccumulator } from "./streaming-moments.js";

/**
 * The column-of-`Float64Array`s shape {@link assembleMcColumns} and
 * {@link mcStats} operate over -- one entry per replicate, matching
 * `runtime/mc-job.ts`'s `McColumns` structurally so the runtime type can be
 * passed directly.
 */
export interface McObservableColumns {
  readonly range: Float64Array;
  readonly apexHeight: Float64Array;
  readonly timeOfFlight: Float64Array;
  readonly impactSpeed: Float64Array;
  /**
   * `1` iff the replicate reached the ground before the horizon; `0`
   * otherwise. A `Uint8Array` for the same reason the runtime one is: a flag
   * that costs one byte does not want eight.
   */
  readonly landed: Uint8Array;
}

/** One worker chunk's contribution: the replicates it covered and their data. */
export interface McChunk {
  /** Global replicate index of the chunk's first replicate (inclusive). */
  readonly startIndex: number;
  /** Global replicate index one past the chunk's last replicate (exclusive). */
  readonly endIndex: number;
  /**
   * Chunk-local buffers of length `endIndex - startIndex`. Written by
   * `runMcRange` at chunk-local positions `[0, endIndex - startIndex)`, which
   * is why the assembler needs both indices to place them back at their
   * global positions.
   */
  readonly columns: McObservableColumns;
}

/**
 * Per-observable statistics over the landed subset of one batch. Sum,
 * sum-of-squares, min and max are the reduction-order-sensitive quantities
 * P6.05 pinned; mean and variance (P6.06) are computed by Welford in the same
 * canonical loop rather than derived from `sum`/`sumSquares`, for the
 * numerical reason on {@link mcStats}.
 *
 * `min` and `max` are `+Infinity` and `-Infinity` respectively when
 * `landedCount === 0`. `sum` and `sumSquares` are `0` in that case. The
 * hash still folds them, so an empty batch has a well-defined hash rather
 * than a NaN.
 */
export interface McObservableStats {
  readonly sum: number;
  readonly sumSquares: number;
  readonly min: number;
  readonly max: number;
  /**
   * Welford mean over the landed subset. `NaN` when `landedCount === 0` — not
   * `0`, which is a legitimate mean and would let an empty batch read as a
   * centred one. This is the numerically stable answer, computed alongside
   * `sum` rather than as `sum / landedCount`, so `mean * landedCount` need not
   * reproduce `sum` to the bit.
   */
  readonly mean: number;
  /**
   * Sample variance (Bessel-corrected, `n - 1`) over the landed subset,
   * computed by Welford's recurrence. `NaN` when `landedCount < 2`: one
   * landed replicate carries no information about spread. This is the field
   * P6.06 exists to make trustworthy — the `sumSquares`-derived form is one
   * subtraction away and is the one that cancels.
   */
  readonly variance: number;
}

/**
 * The full reduction result: total replicates, how many landed, and the
 * per-observable stats over the landed subset.
 */
export interface McStats {
  /** Total replicates in the batch. */
  readonly count: number;
  /**
   * Number of replicates with `landed === 1`; the denominator for every
   * observable's mean.
   */
  readonly landedCount: number;
  readonly range: McObservableStats;
  readonly apexHeight: McObservableStats;
  readonly timeOfFlight: McObservableStats;
  readonly impactSpeed: McObservableStats;
}

/**
 * Assembles an unordered list of worker chunks into a single, full-length
 * {@link McObservableColumns} in canonical replicate-index order.
 *
 * Each chunk's data is copied to its global slice `[startIndex, endIndex)` --
 * so the returned buffers are byte-identical regardless of the order the
 * `chunks` array happens to be in. Chunks must partition `[0, total)`
 * exactly: any overlap, gap, out-of-range or backwards-ranged chunk throws
 * rather than being silently coalesced. That is the shape a bug is most
 * likely to take -- a worker dropping a message, or two workers being asked
 * the same range -- and letting it pass would produce a plausible-looking
 * histogram with the wrong denominator.
 */
export function assembleMcColumns(chunks: readonly McChunk[], total: number): McObservableColumns {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`total must be a non-negative integer, got ${total}`);
  }

  const out: McObservableColumns = {
    range: new Float64Array(total),
    apexHeight: new Float64Array(total),
    timeOfFlight: new Float64Array(total),
    impactSpeed: new Float64Array(total),
    landed: new Uint8Array(total),
  };

  // Coverage bitmap: one bit per replicate, so an overlap or a gap fails the
  // partition check regardless of the order chunks arrive in. Cheaper than a
  // sort of the ranges and does not rely on chunk uniqueness.
  const covered = new Uint8Array(total);

  for (const chunk of chunks) {
    const { startIndex, endIndex, columns } = chunk;
    if (
      !Number.isInteger(startIndex) ||
      !Number.isInteger(endIndex) ||
      startIndex < 0 ||
      endIndex > total ||
      endIndex < startIndex
    ) {
      throw new RangeError(
        `chunk range [${startIndex}, ${endIndex}) is not a subrange of [0, ${total})`,
      );
    }
    const chunkLen = endIndex - startIndex;
    if (
      columns.range.length !== chunkLen ||
      columns.apexHeight.length !== chunkLen ||
      columns.timeOfFlight.length !== chunkLen ||
      columns.impactSpeed.length !== chunkLen ||
      columns.landed.length !== chunkLen
    ) {
      throw new RangeError(
        `chunk column length does not match [${startIndex}, ${endIndex}) width ${chunkLen}`,
      );
    }

    for (let i = 0; i < chunkLen; i++) {
      const global = startIndex + i;
      if (covered[global] !== 0) {
        throw new RangeError(`replicate ${global} covered by more than one chunk`);
      }
      covered[global] = 1;
    }

    // `Float64Array.set(source, offset)` is a memcpy at native speed and is
    // the whole reason we pay for the assembly step: bulk-copying six spans
    // is cheaper than a per-value scatter and, more importantly, cannot
    // accidentally reduce during the copy.
    out.range.set(columns.range, startIndex);
    out.apexHeight.set(columns.apexHeight, startIndex);
    out.timeOfFlight.set(columns.timeOfFlight, startIndex);
    out.impactSpeed.set(columns.impactSpeed, startIndex);
    out.landed.set(columns.landed, startIndex);
  }

  for (let i = 0; i < total; i++) {
    if (covered[i] === 0) {
      throw new RangeError(`replicate ${i} was not covered by any chunk`);
    }
  }

  return out;
}

/**
 * Reduces a full-length {@link McObservableColumns} into {@link McStats},
 * walking the buffer once in canonical replicate-index order (0, 1, ...,
 * `count - 1`) so the resulting numbers are bit-identical for identical
 * input regardless of the order chunks arrived at
 * {@link assembleMcColumns}.
 *
 * Only landed replicates contribute to any observable's sum, sum-of-squares,
 * min or max. `landedCount` reports how many those were so the caller can
 * form means with the correct denominator; `count` reports the batch total
 * so the loss to non-landing is visible.
 *
 * Column lengths are validated against each other rather than trusted, so a
 * mis-assembled batch fails loudly here rather than silently reducing a
 * shorter observable.
 */
export function mcStats(columns: McObservableColumns): McStats {
  const { range, apexHeight, timeOfFlight, impactSpeed, landed } = columns;
  const count = range.length;
  if (
    apexHeight.length !== count ||
    timeOfFlight.length !== count ||
    impactSpeed.length !== count ||
    landed.length !== count
  ) {
    throw new RangeError("mcStats: column lengths do not agree");
  }

  let landedCount = 0;
  let rangeSum = 0;
  let rangeSq = 0;
  let rangeMin = Number.POSITIVE_INFINITY;
  let rangeMax = Number.NEGATIVE_INFINITY;
  let apexSum = 0;
  let apexSq = 0;
  let apexMin = Number.POSITIVE_INFINITY;
  let apexMax = Number.NEGATIVE_INFINITY;
  let tofSum = 0;
  let tofSq = 0;
  let tofMin = Number.POSITIVE_INFINITY;
  let tofMax = Number.NEGATIVE_INFINITY;
  let ispSum = 0;
  let ispSq = 0;
  let ispMin = Number.POSITIVE_INFINITY;
  let ispMax = Number.NEGATIVE_INFINITY;

  // Welford accumulators run in lockstep with the running sums above. They see
  // the same replicates in the same canonical order, so the mean and variance
  // they produce are as reproducible as the sums are -- and, unlike the sums,
  // are numerically stable to read as a variance.
  const rangeMoments = new WelfordAccumulator();
  const apexMoments = new WelfordAccumulator();
  const tofMoments = new WelfordAccumulator();
  const ispMoments = new WelfordAccumulator();

  // The one loop that decides the reduction order for the whole batch. Every
  // observable's sum sees replicates in the same fixed order, so cross-column
  // consistency (all four columns' means from the same replicate set) is a
  // property of the loop shape, not of the caller.
  for (let i = 0; i < count; i++) {
    if (landed[i] === 0) continue;
    landedCount++;

    const r = range[i]!;
    rangeSum += r;
    rangeSq += r * r;
    if (r < rangeMin) rangeMin = r;
    if (r > rangeMax) rangeMax = r;
    rangeMoments.push(r);

    const a = apexHeight[i]!;
    apexSum += a;
    apexSq += a * a;
    if (a < apexMin) apexMin = a;
    if (a > apexMax) apexMax = a;
    apexMoments.push(a);

    const t = timeOfFlight[i]!;
    tofSum += t;
    tofSq += t * t;
    if (t < tofMin) tofMin = t;
    if (t > tofMax) tofMax = t;
    tofMoments.push(t);

    const s = impactSpeed[i]!;
    ispSum += s;
    ispSq += s * s;
    if (s < ispMin) ispMin = s;
    if (s > ispMax) ispMax = s;
    ispMoments.push(s);
  }

  return {
    count,
    landedCount,
    range: statsOf(rangeSum, rangeSq, rangeMin, rangeMax, rangeMoments),
    apexHeight: statsOf(apexSum, apexSq, apexMin, apexMax, apexMoments),
    timeOfFlight: statsOf(tofSum, tofSq, tofMin, tofMax, tofMoments),
    impactSpeed: statsOf(ispSum, ispSq, ispMin, ispMax, ispMoments),
  };
}

/** Assembles one observable's stats block from its running reductions. */
function statsOf(
  sum: number,
  sumSquares: number,
  min: number,
  max: number,
  moments: WelfordAccumulator,
): McObservableStats {
  return { sum, sumSquares, min, max, mean: moments.mean, variance: moments.variance };
}

// --- Hashing ---------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;

/**
 * SplitMix64's finalizing mixer (Steele, Lea & Flood 2014). A bijection on
 * 64 bits, so it cannot map two distinct inputs to the same output -- what
 * this module needs to distinguish two reductions whose numeric outputs
 * differ by one ULP. A private copy rather than an import from
 * `@ballista/engine` because that module's copy is scoped to seed derivation
 * for the RNG and its tests deliberately grade the *property*, not the
 * constants (46th-run changelog note on `splitmix64`'s second multiply). A
 * shared implementation would couple two unrelated properties to the same
 * definition and risk one fix silently breaking the other.
 */
function splitmix64(input: bigint): bigint {
  let z = input & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

// One eight-byte buffer reused across a single hash call to pull the IEEE-754
// bit pattern out of a `number` without allocating per value. Little-endian
// because the code that reads it does so via `getBigUint64(..., true)` -- the
// hash is a fold over the bytes and either endianness is fine so long as it
// is fixed.
const HASH_BUF = new ArrayBuffer(8);
const HASH_VIEW = new DataView(HASH_BUF);

function foldFloat(state: bigint, value: number): bigint {
  // `NaN` has many bit patterns; canonicalise so a NaN produced by different
  // code paths hashes identically. `+0` and `-0` are also folded to `+0`
  // because they are equal under `===` and every consumer of a Monte Carlo
  // statistic would treat them as the same value.
  const v = value !== value ? Number.NaN : value === 0 ? 0 : value;
  HASH_VIEW.setFloat64(0, v, true);
  const bits = HASH_VIEW.getBigUint64(0, true);
  return splitmix64(state ^ bits);
}

function foldInt(state: bigint, value: number): bigint {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`hash counter must be a non-negative integer, got ${value}`);
  }
  return splitmix64(state ^ BigInt(value));
}

/**
 * A 64-bit hash of a full {@link McStats}, folded in a fixed field order via
 * {@link splitmix64}. Exists so P6.05's "shuffled worker completion => same
 * result" can be asserted as a value-level equality rather than as a
 * hand-checked comparison per observable.
 *
 * Returned as a hex string rather than a `bigint` so it can be dropped into
 * a snapshot, a log line or a golden file without a caller having to remember
 * to `.toString(16)` first; the "0x" prefix is included so it round-trips
 * through `BigInt()` unchanged.
 *
 * Non-goals: cryptographic collision resistance, cross-language stability
 * (JavaScript's IEEE-754 semantics are the only thing pinned here), and
 * cross-version stability across future changes to the folding order. If any
 * of those become requirements, replace splitmix64 with a keyed
 * cryptographic PRF and freeze the field order in a schema.
 */
export function hashMcStats(stats: McStats): string {
  // Seed chosen as an obvious constant rather than 0 so that hashing a zero
  // vector does not produce 0 -- that would collide with a hypothetical "no
  // batch" sentinel in a place that meant to distinguish them.
  let h = 0x0123456789abcdefn;
  h = foldInt(h, stats.count);
  h = foldInt(h, stats.landedCount);
  // Field order matches the interface's declaration order and must not
  // change -- callers that snapshot the hash rely on it.
  for (const s of [stats.range, stats.apexHeight, stats.timeOfFlight, stats.impactSpeed]) {
    h = foldFloat(h, s.sum);
    h = foldFloat(h, s.sumSquares);
    h = foldFloat(h, s.min);
    h = foldFloat(h, s.max);
    // mean and variance are derived from the reduction, so folding them adds
    // no independent bits -- but the hash's contract is to cover the WHOLE
    // struct, and a field the hash ignores is a field a reproducibility check
    // silently stops guarding. `NaN` (empty/singleton batches) is
    // canonicalised by `foldFloat`, so an all-non-landing batch still has a
    // well-defined hash.
    h = foldFloat(h, s.mean);
    h = foldFloat(h, s.variance);
  }
  return "0x" + h.toString(16).padStart(16, "0");
}

/**
 * The determinism budget from blueprint §2.6, as a relative tolerance:
 * *"documented tolerance for cross-browser drift ($\lesssim 10^{-13}$
 * relative over a standard flight; measured, not assumed, in CI across
 * engines)"*.
 *
 * This is the **cross-platform** half of P6.27's criterion and nothing else.
 * On one platform the requirement is bit-equality, which {@link hashMcStats}
 * already grades exactly; loosening that to a tolerance would let a real
 * reduction-order regression pass as rounding. So a same-platform check must
 * never reach for this constant.
 *
 * It is a budget, not a measurement. What a second engine actually drifts by
 * is P2.45/P7.11's business to measure and publish; this says only what the
 * project has committed to tolerate.
 */
export const MC_STATS_CROSS_PLATFORM_REL_TOL = 1e-13;

/**
 * Relative difference between two numbers, with the conventions a
 * cross-platform comparison of Monte Carlo statistics needs.
 *
 * `0` for values that are genuinely the same answer, including two `NaN`s
 * (an empty batch's mean is a well-defined non-answer, and two engines
 * agreeing that there is no answer have not drifted) and two infinities of
 * the same sign (`min`/`max` of a batch where nothing landed).
 *
 * `Infinity` where the two are not the same *kind* of answer at all -- a
 * number against a `NaN`, opposite infinities, a finite value against an
 * infinite one. Those are not rounding, and scaling them into a small
 * relative number would hide the one class of disagreement that matters
 * most.
 *
 * Normalised by `max(|a|, |b|)` rather than by one side, so the result does
 * not depend on argument order; two zeros are `0` and a zero against a
 * non-zero is `1`.
 */
function relativeDifference(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  // Unreachable while `a !== b`: scale is 0 only when both are ±0, and those
  // compare equal above. Kept so the function is total by inspection.
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

/**
 * The largest relative difference between any pair of corresponding fields of
 * two {@link McStats}, for grading a cross-platform reproduction against
 * {@link MC_STATS_CROSS_PLATFORM_REL_TOL}.
 *
 * **`count` and `landedCount` are required to be exactly equal, and the
 * result is `Infinity` when they are not.** They are integers, so a
 * disagreement in either is not floating-point drift -- it is two platforms
 * having run different amounts of work, or having disagreed about whether a
 * replicate reached the ground. Averaging that in with the continuous fields
 * would let a genuinely different answer read as a small number, which is the
 * exact failure this comparator exists to prevent.
 *
 * Every continuous field is covered, in the same order {@link hashMcStats}
 * folds them, for the same reason its doc gives: a field the check ignores is
 * a field a reproducibility check silently stops guarding.
 */
export function mcStatsRelativeDrift(a: McStats, b: McStats): number {
  if (a.count !== b.count || a.landedCount !== b.landedCount) return Infinity;
  let worst = 0;
  const pairs: readonly (readonly [McObservableStats, McObservableStats])[] = [
    [a.range, b.range],
    [a.apexHeight, b.apexHeight],
    [a.timeOfFlight, b.timeOfFlight],
    [a.impactSpeed, b.impactSpeed],
  ];
  for (const [x, y] of pairs) {
    for (const field of ["sum", "sumSquares", "min", "max", "mean", "variance"] as const) {
      const d = relativeDifference(x[field], y[field]);
      if (d > worst) worst = d;
    }
  }
  return worst;
}
