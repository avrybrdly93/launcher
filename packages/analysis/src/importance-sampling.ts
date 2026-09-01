/**
 * Importance sampling for rare-event probabilities (P6.23).
 *
 * **The problem, stated as a cost.** To estimate a probability `p` by counting
 * hits, the relative standard error of `p̂ = k/N` is
 *
 * ```
 *   SE(p̂)/p = sqrt((1 − p)/(N p)) ≈ 1/sqrt(N p)
 * ```
 *
 * so **the sample size needed for a fixed *relative* accuracy scales as `1/p`,
 * not as a constant.** Ten percent relative error on `p = 1e-2` costs about
 * `1e4` draws; the same accuracy on `p = 1e-5` costs about `1e7`. That is the
 * whole difficulty with rare events, and it is not a constant-factor problem
 * that a faster integrator fixes. At `p = 1e-5` the *median* outcome of a
 * thousand-draw study is that nothing happens at all — `p̂ = 0`, with a
 * confidence interval that technically contains the truth and tells you
 * nothing.
 *
 * **The fix.** Draw from a different distribution `g` that puts mass where the
 * event actually is, then undo the lie with a weight. For any `g` whose
 * support contains the region where `f` is positive,
 *
 * ```
 *   p = E_f[1{A}] = E_g[1{A} · f(X)/g(X)]
 * ```
 *
 * so the estimator is `p̂_IS = (1/N) Σ 1{A(xᵢ)} wᵢ` with `wᵢ = f(xᵢ)/g(xᵢ)`
 * the **likelihood ratio**. It is unbiased for *any* admissible `g` — the
 * choice of proposal affects variance and nothing else, exactly as the choice
 * of `c` does in `control-variate.ts`. That asymmetry is again why this is an
 * option a caller reaches for rather than a transformation applied silently.
 *
 * **What can go wrong, and why this module reports three numbers rather than
 * one.** A badly chosen proposal does not fail loudly. It returns a plausible
 * number computed almost entirely from one or two draws, and its sample
 * standard error — computed from the same degenerate sample — is small,
 * because the sample it saw really was consistent. So the estimate and its
 * error bar agree with each other and are both wrong. The three diagnostics
 * are what make that visible:
 *
 * - {@link ImportanceSamplingEstimate.effectiveSampleSize}, Kish's
 *   `(Σw)²/Σw²`, is the number of equally-weighted draws carrying the same
 *   information. `N = 10000` with `ESS = 3` is a three-sample study.
 * - {@link ImportanceSamplingEstimate.maxWeightShare}, the largest single
 *   weight as a fraction of their sum. One draw at 0.9 means the answer is
 *   that draw.
 * - {@link ImportanceSamplingEstimate.hits}, the number of draws that landed
 *   in `A` at all. Under a good proposal this is a large fraction of `N`;
 *   under a proposal that missed, it is 2, and `p̂` is then a statement about
 *   those 2.
 *
 * **What this module is not.** It does not know about trajectories,
 * scenarios or the runtime. It reduces two equal-length arrays — an indicator
 * and a likelihood ratio — into an estimate, so it composes with any sampler.
 * {@link normalShiftProposal} supplies the one proposal family whose
 * likelihood ratio is exact in closed form, which is what makes the
 * constructed-tail demo checkable against an analytic answer rather than only
 * against a slower estimate of the same unknown.
 *
 * See `docs/notes/rare-events.md` for the derivation, the optimal-tilt
 * argument, and the measured results.
 */

import { normalQuantile, normalUpperTail } from "@ballista/engine";
import { standardErrorOfMean } from "./mc-convergence.js";

/** Default two-sided confidence level, matching `hit-probability.ts`. */
export const DEFAULT_IS_LEVEL = 0.95;

/** The outcome of an importance-sampling estimate of a probability. */
export interface ImportanceSamplingEstimate {
  /** The estimate `p̂ = (1/N) Σ 1{A} w`. */
  readonly pHat: number;
  /**
   * Standard error of `p̂`, the sample standard deviation of the weighted
   * indicators divided by `sqrt(N)`.
   *
   * **Trust this only alongside {@link effectiveSampleSize}.** It is computed
   * from the same sample whose degeneracy it would need to detect, so under a
   * bad proposal it is small and wrong together with the estimate.
   */
  readonly standardError: number;
  /** Number of draws, `N`. */
  readonly trials: number;
  /** How many draws landed in the event set at all. */
  readonly hits: number;
  /**
   * Kish's effective sample size over the **contributing** draws,
   * `(Σw)²/Σw²` summed over draws in `A`. The number of equally-weighted
   * draws carrying the same information. `NaN` when no draw hit.
   */
  readonly effectiveSampleSize: number;
  /** {@link effectiveSampleSize} divided by {@link trials}, in `[0, 1]`. `NaN` when no draw hit. */
  readonly weightEfficiency: number;
  /**
   * The largest contributing weight as a fraction of the contributing
   * weights' sum, in `(0, 1]`. `NaN` when no draw hit. A value near 1 means
   * one draw *is* the answer.
   */
  readonly maxWeightShare: number;
  /** Lower end of the normal-approximation interval, clamped at 0. */
  readonly lower: number;
  /** Upper end, clamped at 1. */
  readonly upper: number;
  /** The two-sided confidence level. */
  readonly level: number;
}

/** Options for {@link importanceSamplingProbability}. */
export interface ImportanceSamplingOptions {
  /** Two-sided confidence level in `(0, 1)`. Defaults to {@link DEFAULT_IS_LEVEL}. */
  readonly level?: number;
}

/**
 * Estimate `P_f(A)` from draws taken under a proposal `g`.
 *
 * @param indicators - `indicators[i]` is whether draw `i` landed in `A`.
 * @param weights - `weights[i]` is the likelihood ratio `f(xᵢ)/g(xᵢ)`, which
 *   must be finite and non-negative.
 * @param options - see {@link ImportanceSamplingOptions}.
 * @throws RangeError if the arrays differ in length, are empty, or if any
 *   weight is negative or not finite.
 *
 * A weight of exactly 0 is legal and means "`f` puts no mass here" — a draw
 * the proposal made that the nominal distribution would never have made. A
 * *negative* or non-finite weight is a caller bug (usually an un-normalised
 * density or an overflowed `exp`), and is refused rather than propagated into
 * an estimate that would look like a number.
 *
 * An all-zero-weight sample is **not** refused: it is the honest answer
 * `p̂ = 0` from a proposal that never visited anywhere `f` lives. The
 * diagnostics come back `NaN` to say the sample cannot support a variance
 * statement, rather than `0`, which would read as "no uncertainty".
 */
export function importanceSamplingProbability(
  indicators: readonly boolean[],
  weights: readonly number[],
  options: ImportanceSamplingOptions = {},
): ImportanceSamplingEstimate {
  const n = indicators.length;
  if (n !== weights.length) {
    throw new RangeError(
      `importanceSamplingProbability: indicators (${n}) and weights (${weights.length}) differ in length`,
    );
  }
  if (n === 0) {
    throw new RangeError("importanceSamplingProbability: needs at least one draw, got 0");
  }
  const level = options.level ?? DEFAULT_IS_LEVEL;
  if (!(level > 0 && level < 1)) {
    throw new RangeError(`importanceSamplingProbability: level must be in (0, 1), got ${level}`);
  }

  const contributions = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const w = weights[i] ?? Number.NaN;
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(
        `importanceSamplingProbability: weight ${i} must be finite and non-negative, got ${w}`,
      );
    }
    contributions[i] = indicators[i] === true ? w : 0;
  }

  let sum = 0;
  let sumSq = 0;
  let maxWeight = 0;
  let hits = 0;
  for (let i = 0; i < n; i += 1) {
    const c = contributions[i] ?? 0;
    sum += c;
    sumSq += c * c;
    if (c > maxWeight) maxWeight = c;
    if (indicators[i] === true) hits += 1;
  }

  const pHat = sum / n;
  // `standardErrorOfMean` returns null for n < 2, where a sample variance is
  // undefined. NaN rather than 0: a single draw carries no information about
  // its own spread, and 0 would read as certainty.
  const standardError = standardErrorOfMean(contributions) ?? Number.NaN;

  // Degenerate when nothing contributed: `sum` is 0 and every ratio below is
  // 0/0. NaN rather than 0 -- see the doc comment.
  const degenerate = sum === 0;
  const effectiveSampleSize = degenerate ? Number.NaN : (sum * sum) / sumSq;
  const weightEfficiency = degenerate ? Number.NaN : effectiveSampleSize / n;
  const maxWeightShare = degenerate ? Number.NaN : maxWeight / sum;

  // Two-sided: the upper quantile at 1 - alpha/2, the same construction
  // `wilsonInterval` uses in `hit-probability.ts`.
  const z = normalQuantile(1 - (1 - level) / 2);
  const half = z * standardError;
  return {
    pHat,
    standardError,
    trials: n,
    hits,
    effectiveSampleSize,
    weightEfficiency,
    maxWeightShare,
    lower: Math.max(0, pHat - half),
    upper: Math.min(1, pHat + half),
    level,
  };
}

/**
 * A mean-shifted normal proposal: draw from `N(proposalMean, sigma)` while the
 * nominal distribution is `N(mean, sigma)`.
 *
 * The shared `sigma` is deliberate. Shifting the mean alone is the classical
 * tilt for a Gaussian upper tail and it keeps the likelihood ratio a bounded,
 * exactly computable exponential; widening the proposal instead gives ratios
 * that grow without bound in the far tail, which is the textbook way to build
 * an estimator with *infinite* variance while every individual draw still
 * looks fine.
 */
export interface NormalShiftProposal {
  /** Mean of the nominal distribution `f`. */
  readonly mean: number;
  /** Standard deviation, shared by `f` and `g`. Must be positive. */
  readonly sigma: number;
  /** Mean of the proposal `g`. */
  readonly proposalMean: number;
}

/**
 * Validate a {@link NormalShiftProposal}.
 *
 * @throws RangeError if `sigma` is not positive and finite, or if either mean
 *   is not finite.
 */
export function validateNormalShiftProposal(proposal: NormalShiftProposal): void {
  const { mean, sigma, proposalMean } = proposal;
  if (!Number.isFinite(mean)) {
    throw new RangeError(`normal shift proposal: mean must be finite, got ${mean}`);
  }
  if (!Number.isFinite(proposalMean)) {
    throw new RangeError(`normal shift proposal: proposalMean must be finite, got ${proposalMean}`);
  }
  if (!(sigma > 0) || !Number.isFinite(sigma)) {
    throw new RangeError(`normal shift proposal: sigma must be positive and finite, got ${sigma}`);
  }
}

/**
 * The likelihood ratio `f(x)/g(x)` for a {@link NormalShiftProposal}, in
 * closed form.
 *
 * With `d = proposalMean − mean`, the two Gaussians share their normalising
 * constant and their quadratic term, so everything cancels but a linear
 * exponent:
 *
 * ```
 *   log w(x) = −(d/σ²) · (x − mean − d/2)
 * ```
 *
 * Written that way rather than as a difference of two squared z-scores on
 * purpose: at `d = 0` it is exactly `0` and the ratio is exactly `1`, whereas
 * the difference form subtracts two equal large numbers and returns `1` only
 * to within rounding. The far tail is where this estimator is used and where
 * that difference bites.
 *
 * @throws RangeError if the proposal is invalid.
 */
export function normalShiftLikelihoodRatio(x: number, proposal: NormalShiftProposal): number {
  validateNormalShiftProposal(proposal);
  const d = proposal.proposalMean - proposal.mean;
  if (d === 0) return 1;
  const logW = -(d / (proposal.sigma * proposal.sigma)) * (x - proposal.mean - d / 2);
  return Math.exp(logW);
}

/**
 * The variance-optimal-in-practice tilt for estimating `P(X > threshold)` with
 * `X ~ N(mean, sigma)`: **put the proposal mean on the threshold**.
 *
 * Not the exact variance minimiser — that is the zero-variance proposal
 * `f(x)1{x>t}/p`, which requires knowing `p`, the thing being estimated. The
 * mean shift to `t` is the standard large-deviations choice (it is the
 * exponential tilt whose tilted mean equals the constraint), it makes the
 * event a coin flip rather than a rarity, and it is within a small factor of
 * optimal across the whole tail. `docs/notes/rare-events.md` §4 has the
 * argument and the measured comparison against shifts either side of it.
 *
 * A `threshold` at or below `mean` returns `mean` — no tilt. Tilting *towards*
 * an event that is already common raises the variance rather than lowering it,
 * and the honest response to "this event is not rare" is to sample it directly.
 *
 * @throws RangeError if the arguments are not finite, or `sigma` is not positive.
 */
export function normalShiftProposal(
  mean: number,
  sigma: number,
  threshold: number,
): NormalShiftProposal {
  if (!Number.isFinite(threshold)) {
    throw new RangeError(`normalShiftProposal: threshold must be finite, got ${threshold}`);
  }
  const proposal: NormalShiftProposal = {
    mean,
    sigma,
    proposalMean: threshold > mean ? threshold : mean,
  };
  validateNormalShiftProposal(proposal);
  return proposal;
}

/**
 * `P(X > threshold)` for `X ~ N(mean, sigma)`, in closed form.
 *
 * The anchor the constructed-tail demo checks both estimators against. Uses
 * the engine's `normalUpperTail`, which is accurate in the far tail where
 * `1 − normalCdf(z)` has already cancelled to nothing.
 *
 * @throws RangeError if `sigma` is not positive and finite, or the other
 *   arguments are not finite.
 */
export function normalTailProbability(mean: number, sigma: number, threshold: number): number {
  validateNormalShiftProposal({ mean, sigma, proposalMean: mean });
  if (!Number.isFinite(threshold)) {
    throw new RangeError(`normalTailProbability: threshold must be finite, got ${threshold}`);
  }
  return normalUpperTail((threshold - mean) / sigma);
}

/**
 * The brute-force sample size needed for a target *relative* standard error on
 * a probability `p`: `N ≈ (1 − p)/(p · rse²)`.
 *
 * Exposed because it is the number that makes the case for this module. It is
 * what turns "rare events are hard" into "this study costs 4 × 10⁶ draws", and
 * the demo quotes it beside the measured cost of the tilted estimator.
 *
 * @throws RangeError if `p` is not in `(0, 1)` or `relativeStandardError` is
 *   not positive.
 */
export function bruteForceSampleSize(p: number, relativeStandardError: number): number {
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`bruteForceSampleSize: p must be in (0, 1), got ${p}`);
  }
  if (!(relativeStandardError > 0)) {
    throw new RangeError(
      `bruteForceSampleSize: relativeStandardError must be positive, got ${relativeStandardError}`,
    );
  }
  return (1 - p) / (p * relativeStandardError * relativeStandardError);
}

/** Renders an estimate as `p=1.35e-4 ± 8e-6, ESS 412/2000 (21%), max share 0.03`. */
export function formatImportanceSamplingEstimate(estimate: ImportanceSamplingEstimate): string {
  const ess = Number.isNaN(estimate.effectiveSampleSize)
    ? "none"
    : `${estimate.effectiveSampleSize.toFixed(0)}/${estimate.trials} (${(
        estimate.weightEfficiency * 100
      ).toFixed(0)}%)`;
  const share = Number.isNaN(estimate.maxWeightShare) ? "n/a" : estimate.maxWeightShare.toFixed(2);
  return `p=${estimate.pHat.toExponential(2)} ± ${estimate.standardError.toExponential(
    0,
  )}, ESS ${ess}, max share ${share}`;
}
