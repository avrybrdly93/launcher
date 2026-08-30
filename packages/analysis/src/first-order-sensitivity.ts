import { PCG32 } from "@ballista/engine";

/**
 * First-order (delta-method) output spread, and the Monte Carlo comparison that
 * says when to believe it (P6.17).
 *
 * **The estimate.** Blueprint §9.4's second rung: given the local derivatives
 * `∂R/∂μ_k` that {@link ./tangent-linear.js} already carries — at the cost of
 * one augmented solve, not one solve per parameter — the output spread under
 * independent input uncertainties follows from a one-term Taylor expansion,
 *
 * ```
 *   R(μ₀ + δ) ≈ R(μ₀) + Σ_k (∂R/∂μ_k) δ_k
 *   ⇒  σ_R² ≈ Σ_k (∂R/∂μ_k)² σ_k²
 * ```
 *
 * That is one solve against a Monte Carlo study's thousands, and it is the
 * quantity the tornado chart of P6.18 ranks by — `|∂R/∂μ_k| σ_k` is exactly
 * the per-input term of that sum, which is why {@link firstOrderSpread}
 * returns the terms and not only their root.
 *
 * **Why it needs a comparison at all.** The expansion drops two things, and
 * both are silent:
 *
 * 1. **Curvature.** The second-order term contributes `½ Σ ∂²R/∂μ_k² σ_k²` to
 *    the *mean* and `O(σ⁴)` to the variance. The mean shift is the one that
 *    shows up first, which is why {@link MonteCarloSpread.meanShift} is
 *    reported beside the spread: a comparison that only ever looks at σ can
 *    watch a study drift away from its nominal answer and call it agreement.
 * 2. **Interactions.** `σ_R² = Σ (∂R/∂μ_k)² σ_k²` assumes independent inputs
 *    *and* an additive response. Neither is checked here — a first-order
 *    estimate cannot see an interaction, which is precisely the gap P6.19's
 *    Sobol' indices exist to fill.
 *
 * So the first-order number is not wrong, it is *conditional*, and the
 * condition is that the response is linear over the range the inputs actually
 * span. `σ` is what sets that range. This module's job is to make the
 * condition measurable rather than assumed: sweep the input σ, compute both
 * estimates at each scale, and report where they part company.
 *
 * **Common random numbers across the sweep, deliberately.** Every σ scale
 * reuses the *same* standard-normal draws `z`, displaced as `δ_k = s σ_k z_k`.
 * Two consequences, and both are the point:
 *
 * - The trend in the discrepancy across scales is attributable to the response's
 *   nonlinearity, because the draws are held fixed while only their magnitude
 *   varies. Independent draws per scale would add sampling noise of the same
 *   order as the effect being measured on the small-σ end, where the effect is
 *   smallest and the agreement claim is being made.
 * - It is the same argument P6.16's `windReplication: "shared"` default rests
 *   on, applied one level up. A difference between two configurations is only
 *   attributable to the configuration if the randomness underneath them is the
 *   same randomness.
 *
 * The cost is that the points in a sweep are *correlated*, so their errors do
 * not average down independently and a sweep is not N× the evidence of one
 * point. {@link FirstOrderComparisonPoint.standardError} is per-point and
 * carries no such claim.
 *
 * **What "divergence shown" requires.** A discrepancy outside tolerance means
 * nothing on its own — a small enough sample disagrees with anything. A point
 * is {@link FirstOrderComparisonPoint.significant} only when the discrepancy
 * exceeds a multiple of the Monte Carlo σ estimate's own standard error, so
 * "the first-order estimate breaks down here" is a measurement rather than a
 * hope. That standard error is computed from the sample's fourth moment
 * (see {@link monteCarloSpread}) rather than from the Gaussian formula, because
 * the large-σ end — the end where divergence is being claimed — is exactly
 * where the output stops being Gaussian.
 */

/** Standard-normal displacements for one Monte Carlo draw, one entry per input. */
type Draw = readonly number[];

/**
 * The uncertain-input problem this module compares two estimates on.
 *
 * The gradient is supplied rather than computed so that this module carries no
 * dependency on the solver: a caller with a tangent-linear flight passes
 * `rangeSensitivity(flight)`, a caller with a closed form passes the closed
 * form, and the test suite does both. What must be true is that the gradient
 * and {@link evaluate} describe *the same* nominal point and the same
 * parameter order — nothing here can check that, and getting it wrong produces
 * a plausible number rather than an error.
 */
export interface UncertainOutputProblem {
  /** Input names, in the order {@link gradient}, `sigmas` and `evaluate` use. */
  readonly inputs: readonly string[];
  /** `∂R/∂μ_k` at the nominal point, one per input. */
  readonly gradient: readonly number[];
  /** Standard deviation of each input. Zero is allowed; negative is not. */
  readonly sigmas: readonly number[];
  /**
   * The output at the nominal point displaced by `delta` (one per input, in
   * input order). Return `null` when the displaced problem has no answer — a
   * shot that never lands, a solve that fails — rather than throwing or
   * returning a sentinel; those draws are counted and reported as censoring,
   * not silently dropped.
   */
  evaluate(delta: readonly number[]): number | null;
}

/** The delta-method spread and the per-input terms it is built from. */
export interface FirstOrderSpread {
  /** `sqrt(Σ_k (∂R/∂μ_k)² σ_k²)`. */
  readonly sigma: number;
  /**
   * `|∂R/∂μ_k| σ_k` per input — each input's contribution in output units, and
   * the ranking P6.18's tornado chart draws. These are *not* additive into
   * {@link sigma}; their squares are.
   */
  readonly contributions: readonly number[];
}

/** A Monte Carlo estimate of the same spread, plus what the first order cannot see. */
export interface MonteCarloSpread {
  /** Draws attempted. */
  readonly requested: number;
  /** Draws that produced a value. */
  readonly samples: number;
  /** `requested - samples`: draws whose {@link UncertainOutputProblem.evaluate} returned `null`. */
  readonly failures: number;
  /**
   * Whether any draw failed. A censored spread is conditional on the output
   * existing, and so understates the true spread — it is reported rather than
   * thrown so a caller can see *that* a region of input space falls off the
   * problem, but it invalidates the comparison as a test of linearity.
   */
  readonly censored: boolean;
  /** Sample mean of the successful draws. */
  readonly mean: number;
  /** Bessel-corrected sample standard deviation. */
  readonly sigma: number;
  /**
   * Standard error of {@link sigma}, from the sample's fourth central moment:
   * `Var(s) ≈ (μ₄ − σ⁴) / (4 N σ²)`. Reduces to the familiar `σ²/(2N)` for a
   * Gaussian sample and stays honest when the output is not Gaussian, which is
   * the case that matters here. Zero when {@link sigma} is zero.
   */
  readonly standardError: number;
  /**
   * `mean − R(μ₀)`: the second-order signal. First order predicts zero, so any
   * resolvable shift is curvature, visible before the variance discrepancy is.
   */
  readonly meanShift: number;
}

/** One σ scale of the sweep: both estimates and the verdict on their agreement. */
export interface FirstOrderComparisonPoint {
  /** Multiplier applied to every input σ at this point. */
  readonly scale: number;
  /** The delta-method estimate at this scale — linear in `scale`, by construction. */
  readonly firstOrder: number;
  /** The Monte Carlo estimate at this scale. */
  readonly monteCarlo: MonteCarloSpread;
  /**
   * `(firstOrder − mc.sigma) / mc.sigma`. Negative means the first-order
   * estimate *understates* the spread. Zero when both are zero.
   */
  readonly relativeError: number;
  /** `|relativeError| ≤ tolerance`. */
  readonly withinTolerance: boolean;
  /**
   * Whether the discrepancy exceeds `significanceSigmas × mc.standardError` —
   * i.e. whether it is resolvable against Monte Carlo noise at all. A point
   * outside tolerance but not significant says the sample is too small, not
   * that the estimate broke down.
   */
  readonly significant: boolean;
  /** Standard error of the Monte Carlo σ, repeated here for reading the point alone. */
  readonly standardError: number;
}

/** The full exhibit: one nominal point, one gradient, a sweep of σ scales. */
export interface FirstOrderComparison {
  /** Input names, echoed from the problem. */
  readonly inputs: readonly string[];
  /** `∂R/∂μ_k`, echoed from the problem. */
  readonly gradient: readonly number[];
  /** Base input σ, before any scale is applied. */
  readonly sigmas: readonly number[];
  /** `R(μ₀)` — the output with every displacement zero. */
  readonly nominal: number;
  /** The delta-method spread at `scale = 1`, with its per-input terms. */
  readonly firstOrder: FirstOrderSpread;
  /** One entry per requested scale, in the order given. */
  readonly points: readonly FirstOrderComparisonPoint[];
}

/** Knobs for {@link compareFirstOrderToMonteCarlo}. */
export interface FirstOrderComparisonOptions {
  /** Multipliers on the input σ vector. Each must be finite and positive. Default `[1]`. */
  readonly scales?: readonly number[];
  /** Draws per scale. At least 2 — a variance needs two points. Default `1024`. */
  readonly samples?: number;
  /** PCG32 seed. The same seed reproduces the study exactly. Default `1n`. */
  readonly seed?: bigint;
  /** Relative discrepancy counted as agreement. Default `0.1`, P6.17's criterion. */
  readonly tolerance?: number;
  /** Multiples of the Monte Carlo standard error a discrepancy must exceed. Default `3`. */
  readonly significanceSigmas?: number;
}

const DEFAULT_SCALES: readonly number[] = [1];
const DEFAULT_SAMPLES = 1024;
const DEFAULT_SEED = 1n;
const DEFAULT_TOLERANCE = 0.1;
const DEFAULT_SIGNIFICANCE = 3;

/**
 * `σ_R ≈ sqrt(Σ_k (∂R/∂μ_k)² σ_k²)`, with the per-input terms P6.18 ranks by.
 *
 * @param gradient `∂R/∂μ_k` at the nominal point.
 * @param sigmas Input standard deviations, same length and order.
 * @throws If the lengths disagree, any entry is not finite, or any σ is negative.
 */
export function firstOrderSpread(
  gradient: readonly number[],
  sigmas: readonly number[],
): FirstOrderSpread {
  if (gradient.length !== sigmas.length) {
    throw new Error(
      `firstOrderSpread: ${gradient.length} gradient component(s) against ${sigmas.length} ` +
        "sigma(s); they index the same inputs and must have the same length",
    );
  }
  if (gradient.length === 0) {
    throw new Error("firstOrderSpread: no inputs; there is nothing to propagate");
  }

  const contributions: number[] = [];
  let variance = 0;
  for (let k = 0; k < gradient.length; k++) {
    const g = gradient[k]!;
    const s = sigmas[k]!;
    if (!Number.isFinite(g)) {
      throw new Error(`firstOrderSpread: gradient component ${k} is ${g}`);
    }
    if (!Number.isFinite(s) || s < 0) {
      throw new Error(`firstOrderSpread: sigma ${k} is ${s}; it must be finite and non-negative`);
    }
    const term = Math.abs(g) * s;
    contributions.push(term);
    variance += term * term;
  }
  return { sigma: Math.sqrt(variance), contributions };
}

/**
 * Monte Carlo spread of the output over the given displacements.
 *
 * Exported because it is the half of the comparison a caller may want alone —
 * with a study already in hand, for instance — and because the fourth-moment
 * standard error is worth reusing rather than reimplementing.
 *
 * @param nominal `R(μ₀)`, used only for {@link MonteCarloSpread.meanShift}.
 * @throws If fewer than two draws produce a value: a variance is not defined.
 */
export function monteCarloSpread(
  values: readonly (number | null)[],
  nominal: number,
): MonteCarloSpread {
  const kept: number[] = [];
  for (const value of values) {
    if (value === null) continue;
    if (!Number.isFinite(value)) {
      throw new Error(
        `monteCarloSpread: a draw returned ${value}; return null for a draw with no answer, ` +
          "so it is counted as censoring rather than poisoning the moments",
      );
    }
    kept.push(value);
  }
  const n = kept.length;
  if (n < 2) {
    throw new Error(
      `monteCarloSpread: ${n} of ${values.length} draw(s) produced a value; a variance needs two`,
    );
  }

  let mean = 0;
  for (const v of kept) mean += v;
  mean /= n;

  let m2 = 0;
  let m4 = 0;
  for (const v of kept) {
    const d = v - mean;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  const variance = m2 / (n - 1);
  const sigma = Math.sqrt(variance);
  const fourth = m4 / n;

  // Var(s²) ≈ (μ₄ − σ⁴)/N, and Var(s) = Var(s²)/(4σ²) by the delta method.
  // The bracket is non-negative in exact arithmetic (μ₄ ≥ σ⁴ by Jensen) but can
  // go slightly negative from rounding on a near-degenerate sample; clamp it
  // rather than returning NaN.
  let standardError = 0;
  if (sigma > 0) {
    const varianceOfVariance = Math.max(0, fourth - variance * variance) / n;
    standardError = Math.sqrt(varianceOfVariance / (4 * variance));
  }

  return {
    requested: values.length,
    samples: n,
    failures: values.length - n,
    censored: n !== values.length,
    mean,
    sigma,
    standardError,
    meanShift: mean - nominal,
  };
}

/**
 * The P6.17 exhibit: the delta-method spread against a Monte Carlo spread, over
 * a sweep of input-σ scales sharing one set of standard-normal draws.
 *
 * @throws If the problem's arrays disagree in length, if any option is out of
 *   range, or if the nominal evaluation itself fails — a comparison against a
 *   point that does not exist is not a comparison.
 */
export function compareFirstOrderToMonteCarlo(
  problem: UncertainOutputProblem,
  options: FirstOrderComparisonOptions = {},
): FirstOrderComparison {
  const { inputs, gradient, sigmas } = problem;
  if (inputs.length !== gradient.length || inputs.length !== sigmas.length) {
    throw new Error(
      `compareFirstOrderToMonteCarlo: ${inputs.length} input name(s), ${gradient.length} ` +
        `gradient component(s) and ${sigmas.length} sigma(s); all three index the same inputs`,
    );
  }

  const scales = options.scales ?? DEFAULT_SCALES;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const seed = options.seed ?? DEFAULT_SEED;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const significanceSigmas = options.significanceSigmas ?? DEFAULT_SIGNIFICANCE;

  if (scales.length === 0) {
    throw new Error("compareFirstOrderToMonteCarlo: no scales; there is nothing to compare");
  }
  for (const scale of scales) {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(
        `compareFirstOrderToMonteCarlo: scale ${scale} is not a finite positive multiplier`,
      );
    }
  }
  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(
      `compareFirstOrderToMonteCarlo: samples is ${samples}; a variance needs at least 2 draws`,
    );
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`compareFirstOrderToMonteCarlo: tolerance ${tolerance} must be non-negative`);
  }
  if (!Number.isFinite(significanceSigmas) || significanceSigmas < 0) {
    throw new Error(
      `compareFirstOrderToMonteCarlo: significanceSigmas ${significanceSigmas} must be non-negative`,
    );
  }

  const zero = new Array<number>(inputs.length).fill(0);
  const nominal = problem.evaluate(zero);
  if (nominal === null || !Number.isFinite(nominal)) {
    throw new Error(
      `compareFirstOrderToMonteCarlo: the nominal point evaluated to ${nominal}; every spread ` +
        "here is measured against it, so there is nothing to compare",
    );
  }

  // One draw matrix for the whole sweep — see the module header on common
  // random numbers. Drawn before any evaluation so the stream cannot depend on
  // how many draws a given scale happens to reject.
  const rng = new PCG32(seed);
  const draws: Draw[] = [];
  for (let i = 0; i < samples; i++) {
    const row = new Array<number>(inputs.length);
    for (let k = 0; k < inputs.length; k++) row[k] = rng.nextGaussian();
    draws.push(row);
  }

  const base = firstOrderSpread(gradient, sigmas);
  const delta = new Array<number>(inputs.length).fill(0);
  const points: FirstOrderComparisonPoint[] = [];

  for (const scale of scales) {
    const values: (number | null)[] = [];
    for (const draw of draws) {
      for (let k = 0; k < inputs.length; k++) delta[k] = scale * sigmas[k]! * draw[k]!;
      values.push(problem.evaluate(delta));
    }
    const mc = monteCarloSpread(values, nominal);
    const firstOrder = base.sigma * scale;
    const discrepancy = firstOrder - mc.sigma;
    const relativeError =
      mc.sigma === 0 ? (firstOrder === 0 ? 0 : Infinity) : discrepancy / mc.sigma;
    points.push({
      scale,
      firstOrder,
      monteCarlo: mc,
      relativeError,
      withinTolerance: Math.abs(relativeError) <= tolerance,
      significant: Math.abs(discrepancy) > significanceSigmas * mc.standardError,
      standardError: mc.standardError,
    });
  }

  return {
    inputs: [...inputs],
    gradient: [...gradient],
    sigmas: [...sigmas],
    nominal,
    firstOrder: base,
    points,
  };
}
