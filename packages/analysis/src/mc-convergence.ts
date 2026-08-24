/**
 * Measuring the Monte Carlo convergence rate: does the standard error of an
 * estimated mean actually fall as `N^{-1/2}`? (P6.07)
 *
 * **The rate is a claim about the estimator, and it is measurable rather than
 * assumed.** For iid samples with finite variance, `Var(mean of N) = sigma^2/N`
 * *exactly* -- this is not a large-`N` approximation and needs no appeal to the
 * central limit theorem, so the law is testable at batch sizes as small as 16.
 * What makes it worth measuring anyway is that the premise, not the algebra, is
 * what breaks in practice: correlated replicates (a reused substream, an RNG
 * whose period is short against the batch, a seeding scheme that accidentally
 * aligns) still produce a mean and still produce a plausible-looking spread,
 * but their spread stops shrinking at the Monte Carlo rate. A fitted slope of
 * `-0.5` is evidence the replicates really are independent; a slope near `0` is
 * what perfectly correlated draws give, and {@link mcConvergenceStudy}'s own
 * test suite asserts that counterexample rather than only the passing case.
 *
 * **The standard error here is measured across batches, not derived within
 * one.** The cheap route -- take one batch of `N`, report `s/sqrt(N)` -- cannot
 * detect a violation, because it *assumes* the `1/sqrt(N)` law in the very act
 * of applying it, and so returns a perfect `-0.5` slope on correlated input.
 * This module instead splits the sample pool into disjoint batches of size `N`,
 * takes each batch's mean, and reports the sample standard deviation *across
 * those means*. That quantity is an empirical measurement of estimator spread
 * and knows nothing about `sqrt(N)`. {@link McConvergencePoint} carries the
 * derived `s/sqrt(N)` too, as {@link McConvergencePoint.predictedStandardError},
 * so the two can be compared -- but the fitted slope comes from the measured
 * one.
 *
 * **Batches at different sizes reuse the same pool, deliberately.** Drawing
 * fresh replicates for every batch size would cost `sum(K_i * N_i)` integrations
 * for the same precision that re-partitioning one pool of `M` buys for `M`. The
 * reuse correlates the standard-error estimates *across* batch sizes, which
 * shifts the whole fitted line up or down together but does not bias its slope,
 * and within any single batch size the batches remain disjoint and therefore
 * independent. The caller keeps that independence by supplying a pool whose
 * elements are independent draws -- for the replicate generator of P6.03, that
 * means distinct replicate indices.
 *
 * The estimator is generic over `number` samples and lives here, in analysis,
 * rather than beside the Monte Carlo job: `packages/runtime` may import
 * analysis but not the reverse (§2.1's layering), so the measurement against
 * the real range observable is a runtime-side test that feeds this module its
 * range column.
 */

import { logLogSlope } from "./ill-conditioning.js";

/** One batch size's measured spread within a {@link McConvergenceStudy}. */
export interface McConvergencePoint {
  /** The batch size `N` these statistics describe. */
  readonly batchSize: number;
  /**
   * How many disjoint batches of {@link batchSize} the pool yielded, i.e.
   * `floor(poolSize / batchSize)`. Trailing samples that cannot fill a whole
   * batch are dropped rather than forming a short one, since a short batch's
   * mean has a different variance and would bias this point.
   */
  readonly batchCount: number;
  /** Mean of the {@link batchCount} batch means -- the pooled point estimate. */
  readonly meanOfMeans: number;
  /**
   * **The measured quantity.** Sample standard deviation (Bessel-corrected)
   * across the batch means. Under independence this estimates
   * `sigma / sqrt(batchSize)`, and it is what the fitted slope is taken over.
   */
  readonly standardError: number;
  /**
   * Pooled within-batch sample standard deviation -- an estimate of the
   * per-replicate `sigma`, computed across the whole pool rather than from the
   * batch means.
   */
  readonly pooledStdDev: number;
  /**
   * The `sigma/sqrt(N)` value the `1/sqrt(N)` law predicts, for comparison
   * against {@link standardError}. Not used in the fit: it assumes the law
   * being tested.
   */
  readonly predictedStandardError: number;
}

/** The result of {@link mcConvergenceStudy}. */
export interface McConvergenceStudy {
  /** One entry per usable batch size, in ascending batch-size order. */
  readonly points: readonly McConvergencePoint[];
  /**
   * Least-squares slope of `log(standardError)` against `log(batchSize)`. The
   * Monte Carlo rate is `-0.5`. `null` when fewer than two points survive, or
   * when a standard error came out non-positive (identical batch means), since
   * a log fit has nothing to say about either.
   */
  readonly slope: number | null;
}

/**
 * Sample standard deviation with Bessel's correction, or `null` for fewer than
 * two values.
 *
 * Uses a two-pass computation rather than folding `sum` and `sumSquares`: the
 * batch means this is applied to are tightly clustered around a mean that
 * dwarfs their spread -- exactly the shape where `(sumSquares - sum^2/n)/(n-1)`
 * loses its leading digits to cancellation. `streaming-moments.ts` measures
 * that failure; here the whole sample is already in memory, so the two-pass
 * form is simply available and there is no reason to take the fragile one.
 */
export function sampleStdDev(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) {
    return null;
  }
  let mean = 0;
  for (const v of values) {
    mean += v;
  }
  mean /= n;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (n - 1));
}

/**
 * Standard error of the mean of `values`, i.e. `s / sqrt(n)`.
 *
 * This is the *derived* form, valid only under independence. It is exported
 * because callers reporting a single batch's estimate need it (P6.08's
 * confidence bands), but it is deliberately not what
 * {@link mcConvergenceStudy} fits its slope to -- see this module's header.
 */
export function standardErrorOfMean(values: readonly number[]): number | null {
  const s = sampleStdDev(values);
  return s === null ? null : s / Math.sqrt(values.length);
}

/**
 * Split `pool` into disjoint batches of each requested size, measure the spread
 * of the batch means, and fit the log-log slope of that spread against batch
 * size.
 *
 * `batchSizes` are sorted ascending and de-duplicated. A size that cannot yield
 * at least two whole batches is dropped: one batch mean has no spread, so the
 * point would contribute nothing but a hole in the fit. Non-finite samples are
 * rejected outright rather than skipped, because silently dropping them changes
 * the batch sizes the result claims to describe.
 *
 * @throws if `pool` holds a non-finite value, or if any batch size is not a
 * positive integer.
 */
export function mcConvergenceStudy(
  pool: readonly number[],
  batchSizes: readonly number[],
): McConvergenceStudy {
  for (let i = 0; i < pool.length; i++) {
    if (!Number.isFinite(pool[i]!)) {
      throw new Error(`mcConvergenceStudy: pool[${i}] is ${pool[i]}; samples must be finite`);
    }
  }
  for (const size of batchSizes) {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(`mcConvergenceStudy: batch size must be a positive integer; got ${size}`);
    }
  }

  const sizes = [...new Set(batchSizes)].sort((a, b) => a - b);
  const points: McConvergencePoint[] = [];

  for (const batchSize of sizes) {
    const batchCount = Math.floor(pool.length / batchSize);
    if (batchCount < 2) {
      continue;
    }
    const used = batchCount * batchSize;
    const batchMeans: number[] = [];
    for (let b = 0; b < batchCount; b++) {
      const start = b * batchSize;
      let sum = 0;
      for (let i = start; i < start + batchSize; i++) {
        sum += pool[i]!;
      }
      batchMeans.push(sum / batchSize);
    }
    const standardError = sampleStdDev(batchMeans);
    const pooledStdDev = sampleStdDev(pool.slice(0, used));
    if (standardError === null || pooledStdDev === null) {
      continue;
    }
    let meanOfMeans = 0;
    for (const m of batchMeans) {
      meanOfMeans += m;
    }
    meanOfMeans /= batchCount;
    points.push({
      batchSize,
      batchCount,
      meanOfMeans,
      standardError,
      pooledStdDev,
      predictedStandardError: pooledStdDev / Math.sqrt(batchSize),
    });
  }

  const slope = logLogSlope(
    points.map((p) => p.batchSize),
    points.map((p) => p.standardError),
  );
  return { points, slope };
}
