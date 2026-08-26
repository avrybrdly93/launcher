/**
 * Control-variate estimation for a Monte Carlo mean (P6.13).
 *
 * **The idea in one line.** If a cheap quantity `X` is correlated with the
 * expensive one `Y` *and* `E[X]` is known exactly, then every replicate tells
 * you something about how lucky that draw was — and you can subtract the luck
 * off. The estimator is
 *
 * ```
 *   Ŷ_cv = ȳ − c (x̄ − E[X])
 * ```
 *
 * which has the same expectation as `ȳ` for *any* fixed `c`, because
 * `E[x̄ − E[X]] = 0`. Choosing `c` well is what shrinks the variance;
 * choosing it badly costs accuracy but never correctness. That asymmetry is
 * the reason this module exists as an option a caller can reach for rather
 * than a transformation applied silently.
 *
 * **The control here is the drag-free analytic range** — the blueprint §7
 * uncertainty section calls it "a superb CV: cheap, correlated, exact mean",
 * and all three clauses matter. It is `v₀² sin(2θ)/g` from `range-root.ts`:
 * a multiply and a sine against an integrated trajectory's thousands of
 * derivative evaluations (cheap); it is the same physics with one force
 * removed, so it moves with the real range draw for draw (correlated); and
 * its mean under a distribution on `v₀` is available in closed form
 * (exact mean). {@link dragFreeRangeControlMean} supplies the third for the
 * normal-`v₀` case, which is what the exhibit measures.
 *
 * **The optimal coefficient, and why estimating it is not free.**
 * Minimising `Var(ȳ − c(x̄ − E[X]))` over `c` gives
 *
 * ```
 *   c* = Cov(X, Y) / Var(X),     Var(Ŷ_cv) = Var(ȳ) (1 − ρ²)
 * ```
 *
 * with `ρ = corr(X, Y)`. So the variance reduction factor is `1 − ρ²` and
 * nothing else: a control correlated at `ρ = 0.9` removes 81% of the
 * variance, one at `ρ = 0.3` removes 9% and is not worth the plumbing. The
 * factor is reported as {@link ControlVariateEstimate.varianceReductionFactor}
 * rather than left for the caller to derive, because "we applied a control
 * variate" is not a result — the factor is.
 *
 * `c*` is unknown in practice and is estimated from the same sample. **That
 * makes the estimator biased, by `O(1/N)`**, since `ĉ` is correlated with
 * `x̄`. The bias is real and this module does not pretend otherwise: it is
 * one order smaller than the `O(N^{-1/2})` standard error, so it vanishes
 * beneath the noise at any usable `N` — but it is a bias, not an absence of
 * one, and `control-variate-variance-reduction.test.ts` measures it against
 * plain MC at the sample sizes a user would actually run rather than
 * asserting it away. A caller who needs a strictly unbiased estimate can pass
 * a `c` obtained from a pilot sample via {@link ControlVariateOptions.coefficient},
 * which removes the correlation and with it the bias.
 *
 * **What this module is not.** It is not a variance-reduction framework and
 * it does not know about scenarios, replicates or the runtime. It reduces two
 * equal-length arrays of numbers plus a known mean into an estimate — so it
 * composes with `antitheticReplicates` (engine, P6.12), with plain
 * `replicates`, or with any future sampler, none of which it needs to import.
 */

import { standardErrorOfMean } from "./mc-convergence.js";
import { dragFreeRange } from "./range-root.js";

/** Options for {@link controlVariateMean}. */
export interface ControlVariateOptions {
  /**
   * The control coefficient `c`. Omit to use the sample-optimal
   * `ĉ = Cov(x, y)/Var(x)`.
   *
   * Supplying a value is the way to obtain a **strictly unbiased** estimate:
   * a `c` that does not depend on this sample is uncorrelated with `x̄`, so
   * `E[ȳ − c(x̄ − E[X])] = E[Y]` exactly rather than to `O(1/N)`. The usual
   * source is a pilot run. Any finite value is accepted, including a bad one
   * — a wrong `c` inflates the variance and the reported factor will say so
   * by exceeding 1.
   */
  readonly coefficient?: number;
}

/**
 * A control-variate estimate and everything needed to judge it.
 *
 * Every field is reported rather than any being derivable-in-principle by the
 * caller, because the point of the task is that a variance reduction is a
 * *measured claim*: an estimate that arrives without its factor and its plain
 * counterpart cannot be checked, only believed.
 */
export interface ControlVariateEstimate {
  /** The control-variate estimate `ȳ − c(x̄ − E[X])`. */
  readonly estimate: number;
  /** The plain Monte Carlo mean `ȳ`, for comparison. Never used in `estimate`'s place. */
  readonly plainMean: number;
  /** The coefficient actually used — `ĉ` when it was estimated, else the caller's. */
  readonly coefficient: number;
  /** `true` when {@link coefficient} came from this sample, and the `O(1/N)` bias therefore applies. */
  readonly coefficientEstimated: boolean;
  /** Sample correlation between control and observable. In `[-1, 1]`; `NaN` if either is constant. */
  readonly correlation: number;
  /**
   * `1 − ρ̂²`: the factor by which the estimator's variance is expected to
   * shrink. Below 1 is a win, 1 is no effect, and **above 1 is possible** when
   * a caller supplies a `c` far from optimal — reported honestly rather than
   * clamped, because a control that is hurting is a thing the caller needs to
   * see. `NaN` when {@link correlation} is.
   */
  readonly varianceReductionFactor: number;
  /**
   * Standard error of {@link estimate}: the plain SE scaled by `√(1 − ρ̂²)`.
   *
   * This is the *asymptotic* SE — it treats `ĉ` as known, which it is not.
   * At the `N` where that matters the `O(1/N)` bias matters too; both are
   * measured in the exhibit rather than argued.
   *
   * `null` when `n < 2`, matching {@link standardErrorOfMean}.
   */
  readonly standardError: number | null;
  /** Standard error of {@link plainMean}, so the reduction is visible as two numbers. `null` when `n < 2`. */
  readonly plainStandardError: number | null;
  /** Number of paired samples. */
  readonly sampleSize: number;
}

/**
 * Estimates `E[Y]` using `X` as a control variate with known mean
 * `knownControlMean`.
 *
 * `observable` and `control` are paired element-wise: `control[i]` must be the
 * control evaluated on **the same replicate** that produced `observable[i]`.
 * That pairing is the entire source of the correlation the method exploits,
 * and nothing in the arithmetic can detect a misalignment — a shuffled control
 * array yields `ρ̂ ≈ 0`, a factor of ≈ 1 and an estimate that is merely `ȳ`
 * with extra steps. It fails silently and in the safe direction, which is
 * worth knowing but is not a reason to skip checking the caller's own pairing.
 *
 * @throws if the arrays differ in length, are empty, or hold a non-finite
 * value; and if `knownControlMean` is not finite. A `NaN` from a diverged
 * solve must not be averaged into an estimate — the same commitment
 * `hit-probability.ts` makes about a `NaN` impact.
 */
export function controlVariateMean(
  observable: readonly number[],
  control: readonly number[],
  knownControlMean: number,
  options: ControlVariateOptions = {},
): ControlVariateEstimate {
  const n = observable.length;
  if (n === 0) {
    throw new Error("controlVariateMean: needs at least one sample");
  }
  if (control.length !== n) {
    throw new Error(
      `controlVariateMean: observable has ${n} samples but control has ${control.length}; ` +
        "they must be paired element-wise",
    );
  }
  if (!Number.isFinite(knownControlMean)) {
    throw new Error(`controlVariateMean: knownControlMean is ${knownControlMean}; must be finite`);
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(observable[i]!)) {
      throw new Error(`controlVariateMean: observable[${i}] is ${observable[i]}; must be finite`);
    }
    if (!Number.isFinite(control[i]!)) {
      throw new Error(`controlVariateMean: control[${i}] is ${control[i]}; must be finite`);
    }
  }

  // Two-pass moments rather than the one-pass `E[XY] − E[X]E[Y]` form, for the
  // reason `streaming-moments.ts` gives at length: on a range column whose mean
  // is many times its spread, the one-pass covariance subtracts two nearly
  // equal large numbers and loses most of its significant digits before the
  // division that follows. A control variate is *specifically* applied to a
  // strongly correlated pair, which is exactly the regime where that
  // cancellation is worst.
  let meanY = 0;
  let meanX = 0;
  for (let i = 0; i < n; i++) {
    meanY += observable[i]!;
    meanX += control[i]!;
  }
  meanY /= n;
  meanX /= n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = control[i]! - meanX;
    const dy = observable[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  // Correlation is scale-free, so it needs no Bessel correction: the `n − 1`
  // factors cancel top and bottom. A constant column gives `0/0`; `NaN` is the
  // honest answer and is propagated rather than replaced by a 0 that would
  // read as "measured, and uncorrelated".
  const correlation = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;

  const supplied = options.coefficient;
  if (supplied !== undefined && !Number.isFinite(supplied)) {
    throw new Error(`controlVariateMean: coefficient is ${supplied}; must be finite`);
  }
  const coefficientEstimated = supplied === undefined;

  // `ĉ = Sxy/Sxx`. With a constant control there is no information to correct
  // with; `c = 0` degrades to plain MC, which is the right degenerate
  // behaviour — the alternative is a division by zero propagating an Infinity
  // into the estimate.
  const coefficient = supplied ?? (sxx > 0 ? sxy / sxx : 0);

  const estimate = meanY - coefficient * (meanX - knownControlMean);

  const plainStandardError = standardErrorOfMean(observable);

  // Var(Ŷ_cv) = Var(ȳ)(1 − ρ²) at c = c*. For a caller-supplied c the general
  // form is Var(ȳ) − 2c·Cov(x̄,ȳ) + c²Var(x̄), which is what is computed here so
  // that a deliberately poor c reports the inflation it actually causes rather
  // than the reduction the optimal c would have delivered.
  const varYBar = syy / (n - 1) / n;
  const varXBar = sxx / (n - 1) / n;
  const covBar = sxy / (n - 1) / n;
  const varCv = varYBar - 2 * coefficient * covBar + coefficient * coefficient * varXBar;

  const varianceReductionFactor = varYBar > 0 ? varCv / varYBar : Number.NaN;

  // `varCv` is a variance and cannot be negative in exact arithmetic; rounding
  // can push it a hair below zero when the reduction is near-total (the
  // antithetic exhibit's 97.5% case is that regime). Clamp at zero rather than
  // returning `NaN` from the square root, and only there.
  const standardError = n < 2 ? null : Math.sqrt(Math.max(varCv, 0));

  return {
    estimate,
    plainMean: meanY,
    coefficient,
    coefficientEstimated,
    correlation,
    varianceReductionFactor,
    standardError,
    plainStandardError,
    sampleSize: n,
  };
}

/**
 * The exact mean of {@link dragFreeRange} at a fixed launch angle when `v₀` is
 * normally distributed — the "exact mean" half of what makes the drag-free
 * range a usable control.
 *
 * Range is `v₀² sin(2θ)/g`, so its expectation needs `E[v₀²]`, which for
 * `v₀ ~ N(μ, σ)` is `μ² + σ²` — *not* `μ²`. The `σ²` term is the whole
 * subtlety: dropping it makes the control's assumed mean too small by
 * `σ² sin(2θ)/g`, and since a control variate corrects toward the mean it is
 * handed, a wrong mean does not add noise — **it shifts the estimate by
 * exactly `c` times the error, silently and without widening the interval that
 * would have revealed it.** At `μ = 40, σ = 6` the term is 2.2% of the range,
 * which is far larger than the standard error it would be hiding behind.
 *
 * This is the case the P6.13 exhibit measures. Other input laws need their own
 * `E[v₀²]`; a caller with a different distribution should pass their own known
 * mean to {@link controlVariateMean} rather than reaching for this helper,
 * which is why it takes `mean`/`stdDev` explicitly instead of a distribution
 * spec it would have to interpret.
 *
 * @throws if `stdDev` is negative or either parameter is not finite.
 */
export function dragFreeRangeControlMean(
  mean: number,
  stdDev: number,
  theta: number,
  g?: number,
): number {
  if (!Number.isFinite(mean) || !Number.isFinite(stdDev) || !Number.isFinite(theta)) {
    throw new Error("dragFreeRangeControlMean: mean, stdDev and theta must be finite");
  }
  if (stdDev < 0) {
    throw new Error(`dragFreeRangeControlMean: stdDev is ${stdDev}; must be non-negative`);
  }
  // E[v0^2] sin(2θ)/g, expressed through dragFreeRange so the sin(2θ)/g factor
  // has exactly one definition in the package. `dragFreeRange` squares its
  // first argument, so passing √(μ² + σ²) gives E[v0²] sin(2θ)/g.
  return dragFreeRange(Math.sqrt(mean * mean + stdDev * stdDev), theta, g);
}

/**
 * Renders a {@link ControlVariateEstimate} as
 * `1631.9 ± 2.1 (plain 1630.4 ± 13.7), factor 0.024, rho 0.988, n=64`.
 *
 * Both estimates and both standard errors, always. A reduction shown without
 * the thing it reduced is not checkable, and the correlation is what explains
 * the factor — `1 − ρ²` is the whole story and a reader who can see `ρ` can
 * verify the factor by eye.
 */
export function formatControlVariateEstimate(estimate: ControlVariateEstimate): string {
  const se = estimate.standardError === null ? "n/a" : estimate.standardError.toFixed(1);
  const plainSe =
    estimate.plainStandardError === null ? "n/a" : estimate.plainStandardError.toFixed(1);
  return (
    `${estimate.estimate.toFixed(1)} ± ${se} ` +
    `(plain ${estimate.plainMean.toFixed(1)} ± ${plainSe}), ` +
    `factor ${estimate.varianceReductionFactor.toFixed(3)}, ` +
    `rho ${estimate.correlation.toFixed(3)}, ` +
    `n=${estimate.sampleSize}`
  );
}
