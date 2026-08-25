/**
 * Confidence intervals for a Monte Carlo mean, and the Student-t distribution
 * they need. (P6.08)
 *
 * **Why `t` and not `z`.** A Monte Carlo estimate reports `mean ± c · SE`, and
 * the honest choice of `c` depends on the fact that `SE` is itself estimated
 * from the same sample. Using the normal quantile `z = 1.96` pretends the
 * per-replicate sigma was known in advance; it was not, and the extra
 * uncertainty in `s` widens the interval. The correction is not academic at the
 * sample sizes an interactive Monte Carlo run actually uses -- at `n = 5` the
 * 95% multiplier is `2.776`, not `1.96`, so a `z`-based band is **29% too
 * narrow** and covers the truth about 88% of the time instead of 95%.
 * `mc-confidence-coverage.test.ts` in `runtime` measures exactly that
 * under-coverage against the real pipeline rather than asserting it from
 * theory.
 *
 * **"Displayed honestly with `N`" is a requirement on the value, not on the
 * chart.** An interval detached from its sample size is unreadable: `± 3.1 m`
 * means something very different from 8 replicates than from 8000, and a reader
 * cannot tell which without being told. So {@link MeanConfidenceInterval}
 * carries {@link MeanConfidenceInterval.sampleSize},
 * {@link MeanConfidenceInterval.degreesOfFreedom} and
 * {@link MeanConfidenceInterval.level} alongside the bounds, and
 * {@link formatMeanConfidenceInterval} renders all three. A plotting layer may
 * draw the band however it likes, but it cannot obtain one without also
 * receiving the `n` that produced it.
 *
 * **Tail policy, mirroring `normal-distribution-functions.ts` in `engine`.**
 * The upper tail {@link studentTUpperTail} is computed as itself rather than as
 * `1 - cdf`, and {@link studentTQuantile} solves in the tail. For a 99.9%
 * interval the quantity of interest is `5e-4`, and `1 - cdf` would deliver it
 * with three of its sixteen digits intact.
 *
 * **What is approximated and what is not.** `Var(mean of n) = sigma²/n` is
 * exact for iid finite-variance samples, and the `t` distribution of
 * `(mean - mu) / (s/√n)` is exact when the samples are *normal*. Monte Carlo
 * replicates generally are not, so the coverage of a `t` interval is asymptotic
 * in the usual CLT sense and is a claim to be measured rather than assumed --
 * which is what {@link coverageOfMean} exists to do, and what P6.08's criterion
 * requires against the drag-free range.
 */

import { normalQuantile } from "@ballista/engine";
import { standardErrorOfMean } from "./mc-convergence.js";

// --------------------------------------------------------------------------
// Student-t distribution functions
// --------------------------------------------------------------------------

/** Lanczos coefficients, `g = 7`, `n = 9`. Relative error below 1e-15. */
const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

/**
 * `log Γ(x)` for `x > 0`, by the Lanczos approximation.
 *
 * Logarithmic because the incomplete beta below needs `Γ(a+b)/(Γ(a)Γ(b))` at
 * arguments where each factor overflows long before the ratio does: for a Monte
 * Carlo batch of 200 the ratio is finite and ordinary while `Γ(100)` is `1e156`.
 */
function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection, so the series is only ever evaluated where it converges well.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let series = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) {
    series += LANCZOS[i]! / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

/**
 * The continued fraction for the incomplete beta function, by the modified
 * Lentz algorithm.
 *
 * Converges rapidly only for `x < (a+1)/(a+b+2)`;
 * {@link regularizedIncompleteBeta} is responsible for reflecting the argument
 * into that range, exactly as `regularizedGammaQHalf` in `engine` splits its
 * own series and continued-fraction branches.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const EPS = 3e-16;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    // Even step.
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    // Odd step.
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  return h;
}

/**
 * The regularised incomplete beta function `I_x(a, b)`.
 *
 * Only ever called here with `b = 1/2` and `a = df/2`, but written generally
 * because a special-cased version would be no shorter and much harder to test.
 */
function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * The Student-t upper-tail probability, `Q(t; df) = P(T > t)`.
 *
 * Computed as itself rather than as `1 - cdf`. For `t = 4` and `df = 10` this
 * returns `1.26e-3`; `1 - studentTCdf(4, 10)` agrees to about thirteen digits
 * today but has no reason to as the tail deepens, and the whole point of a
 * confidence band is the tail.
 *
 * @throws if `df` is not a positive finite number, or `t` is not finite.
 */
export function studentTUpperTail(t: number, df: number): number {
  if (!Number.isFinite(df) || df <= 0) {
    throw new Error(`degrees of freedom must be a positive finite number, got ${df}`);
  }
  if (!Number.isFinite(t)) {
    throw new Error(`t must be finite, got ${t}`);
  }
  // I_{df/(df+t^2)}(df/2, 1/2) is twice the probability beyond |t|.
  const half = 0.5 * regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? half : 1 - half;
}

/**
 * The Student-t cumulative distribution function, `P(T <= t)`.
 *
 * @throws if `df` is not a positive finite number, or `t` is not finite.
 */
export function studentTCdf(t: number, df: number): number {
  return studentTUpperTail(-t, df);
}

/** The Student-t probability density. Used as Newton's derivative below. */
function studentTPdf(t: number, df: number): number {
  return Math.exp(
    logGamma((df + 1) / 2) -
      logGamma(df / 2) -
      0.5 * Math.log(df * Math.PI) -
      ((df + 1) / 2) * Math.log1p((t * t) / df),
  );
}

/**
 * The Student-t quantile: the `t` with `P(T <= t) = p`.
 *
 * Solved in the upper tail by Newton's method under a bisection safeguard,
 * seeded from {@link normalQuantile} -- which is the right seed because the
 * normal *is* the `df → ∞` limit, so the guess improves exactly where `t` gets
 * harder to bracket. The safeguard matters at small `df`: the `t` density is
 * heavy-tailed enough that an unguarded Newton step from the normal seed can
 * overshoot past the root for `df = 1`, where the true multiplier is `12.7`
 * against the seed's `1.96`.
 *
 * The seed therefore affects iteration count only, never the answer, which is
 * converged to a relative `1e-15` -- the same policy `normalQuantile` itself
 * follows in `engine`.
 *
 * @throws if `p` is not strictly inside `(0, 1)`, or `df` is not a positive
 * finite number.
 */
export function studentTQuantile(p: number, df: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`p must lie strictly inside (0, 1), got ${p}`);
  }
  if (!Number.isFinite(df) || df <= 0) {
    throw new Error(`degrees of freedom must be a positive finite number, got ${df}`);
  }
  if (p === 0.5) return 0;
  // Symmetry: solve the upper half and reflect. Keeps the target probability
  // away from 1, where its representable resolution collapses.
  if (p < 0.5) return -studentTQuantile(1 - p, df);

  const q = 1 - p; // target upper-tail mass, in (0, 0.5)
  let lo = 0;
  let hi = Math.max(1, normalQuantile(p));
  // Expand until the tail beyond `hi` is lighter than the target, so the root
  // is bracketed. Doubling terminates: Q is strictly decreasing to 0.
  while (studentTUpperTail(hi, df) > q) {
    lo = hi;
    hi *= 2;
    if (!Number.isFinite(hi)) {
      throw new Error(`could not bracket the t quantile for p=${p}, df=${df}`);
    }
  }

  let t = Math.min(Math.max(normalQuantile(p), lo), hi);
  for (let i = 0; i < 100; i++) {
    const gap = studentTUpperTail(t, df) - q;
    if (gap > 0) lo = t;
    else hi = t;
    const slope = studentTPdf(t, df);
    // Newton step; fall back to bisection if it leaves the bracket or the
    // density has underflowed to nothing.
    let next = slope > 0 ? t + gap / slope : (lo + hi) / 2;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - t) <= 1e-15 * Math.abs(next)) return next;
    t = next;
  }
  return t;
}

// --------------------------------------------------------------------------
// The interval
// --------------------------------------------------------------------------

/**
 * A two-sided confidence interval for a mean, carrying everything a reader
 * needs to interpret its width.
 */
export interface MeanConfidenceInterval {
  /** The point estimate: the sample mean. */
  readonly mean: number;
  /** `s / √n`, the estimated standard error of {@link mean}. */
  readonly standardError: number;
  /** `n`. Present so no consumer can display the band without it. */
  readonly sampleSize: number;
  /** `n - 1`, the degrees of freedom of the `t` multiplier. */
  readonly degreesOfFreedom: number;
  /** Nominal coverage, e.g. `0.95`. */
  readonly level: number;
  /** The `t` multiplier at {@link level} and {@link degreesOfFreedom}. */
  readonly tCritical: number;
  /** `tCritical · standardError`. */
  readonly halfWidth: number;
  /** `mean - halfWidth`. */
  readonly lower: number;
  /** `mean + halfWidth`. */
  readonly upper: number;
}

/**
 * A two-sided `t` confidence interval for the mean of `values`.
 *
 * Returns `null` for fewer than two samples: with `n = 1` the standard error is
 * undefined and there is no honest interval to report. A caller that renders a
 * band must handle that case rather than being handed a zero-width one, which
 * would read as infinite precision.
 *
 * A degenerate sample -- every value identical -- yields a zero-width interval,
 * which is correct: the estimated variance really is zero. It is the caller's
 * business to notice that this usually means the jitter was not wired up.
 *
 * @throws if `values` holds a non-finite number, or `level` is not strictly
 * inside `(0, 1)`. Non-finite samples throw rather than being skipped, matching
 * `mcConvergenceStudy`: dropping them silently would change the `n` the result
 * claims to describe.
 */
export function meanConfidenceInterval(
  values: readonly number[],
  level = 0.95,
): MeanConfidenceInterval | null {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    throw new Error(`confidence level must lie strictly inside (0, 1), got ${level}`);
  }
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new Error(`sample contains a non-finite value: ${v}`);
    }
  }
  const n = values.length;
  if (n < 2) return null;

  const standardError = standardErrorOfMean(values);
  /* c8 ignore next -- n >= 2 above already guarantees a value here. */
  if (standardError === null) return null;

  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  const degreesOfFreedom = n - 1;
  // Two-sided: split the excluded mass between the tails.
  const tCritical = studentTQuantile(1 - (1 - level) / 2, degreesOfFreedom);
  const halfWidth = tCritical * standardError;
  return {
    mean,
    standardError,
    sampleSize: n,
    degreesOfFreedom,
    level,
    tCritical,
    halfWidth,
    lower: mean - halfWidth,
    upper: mean + halfWidth,
  };
}

/** Formatting options for {@link formatMeanConfidenceInterval}. */
export interface ConfidenceIntervalFormat {
  /** Significant decimals for the estimate and half-width. Default 2. */
  readonly digits?: number;
  /** Appended to both numbers, e.g. `"m"`. Default none. */
  readonly unit?: string;
}

/**
 * Render an interval as `91.78 ± 3.06 m (95% CI, n = 64)`.
 *
 * The sample size is not optional and there is no format that omits it. That is
 * the whole of "displayed honestly with `N`": a half-width alone invites the
 * reader to treat a 5-replicate pilot run and a 5000-replicate study as the
 * same claim.
 */
export function formatMeanConfidenceInterval(
  ci: MeanConfidenceInterval,
  format: ConfidenceIntervalFormat = {},
): string {
  const digits = format.digits ?? 2;
  const unit = format.unit === undefined ? "" : ` ${format.unit}`;
  const pct = `${Number((ci.level * 100).toFixed(6))}%`;
  return (
    `${ci.mean.toFixed(digits)} ± ${ci.halfWidth.toFixed(digits)}${unit} ` +
    `(${pct} CI, n = ${ci.sampleSize})`
  );
}

// --------------------------------------------------------------------------
// Coverage
// --------------------------------------------------------------------------

/** The outcome of a coverage study. See {@link coverageOfMean}. */
export interface CoverageResult {
  /** How many samples produced an interval and were therefore counted. */
  readonly repeats: number;
  /** How many of those intervals contained the truth. */
  readonly covered: number;
  /** `covered / repeats`, or `NaN` when nothing was counted. */
  readonly coverage: number;
  /** The nominal level the intervals were built at. */
  readonly nominal: number;
  /**
   * `√(nominal · (1 - nominal) / repeats)` -- the standard deviation of the
   * observed proportion *if* coverage were exactly nominal.
   *
   * This is the scale any assertion on {@link coverage} must be written
   * against. At the criterion's `n = 200` repeats it is `0.0154`, so a run
   * landing on `0.94` is a third of a sigma away and evidence of nothing.
   * Comparing a coverage proportion to `0.95` without it produces a test that
   * either never fails or fails at random.
   */
  readonly standardError: number;
  /** Samples too small to yield an interval, and so excluded from the count. */
  readonly skipped: number;
}

/**
 * Count how often a `level` interval built from each sample contains `truth`.
 *
 * This is the empirical check on a claim that is only asymptotically true for
 * non-normal data. It takes pre-drawn samples rather than a generator so the
 * caller keeps control of seeding -- P6.03's replicate `i` is a pure function
 * of seed and index, and a coverage test that drew its own randomness would
 * throw that determinism away and start flaking.
 *
 * @throws if `truth` is not finite, or via {@link meanConfidenceInterval} for a
 * bad level or a non-finite sample.
 */
export function coverageOfMean(
  samples: readonly (readonly number[])[],
  truth: number,
  level = 0.95,
): CoverageResult {
  if (!Number.isFinite(truth)) {
    throw new Error(`truth must be finite, got ${truth}`);
  }
  let covered = 0;
  let repeats = 0;
  let skipped = 0;
  for (const sample of samples) {
    const ci = meanConfidenceInterval(sample, level);
    if (ci === null) {
      skipped++;
      continue;
    }
    repeats++;
    if (truth >= ci.lower && truth <= ci.upper) covered++;
  }
  return {
    repeats,
    covered,
    coverage: repeats === 0 ? NaN : covered / repeats,
    nominal: level,
    standardError: repeats === 0 ? NaN : Math.sqrt((level * (1 - level)) / repeats),
    skipped,
  };
}
