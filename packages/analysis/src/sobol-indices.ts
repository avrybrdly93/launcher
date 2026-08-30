/**
 * Sobol' variance-based sensitivity indices, first-order and total (P6.19).
 *
 * **The gap this fills.** {@link ./tornado.js}'s module header names it: an
 * one-at-a-time tornado moves each input along its own axis through the
 * nominal point, so a response whose sensitivity to θ depends on `v₀` has a
 * ridge no axis passes along, and OAT reports the sensitivity at one
 * particular `v₀` as though it were the sensitivity. That is not a resolution
 * problem more points fix — it is the method's shape. Sobol' indices measure
 * something else entirely, and the difference between the two indices below
 * *is* the interaction.
 *
 * **What the indices are.** For independent inputs the output variance
 * decomposes uniquely into contributions from each input and each combination
 * (Sobol' 1993):
 *
 * ```
 * V = Σ_k V_k + Σ_{k<l} V_kl + … + V_{1..d}
 * ```
 *
 * - The **first-order index** `S_k = V_k / V = Var(E[Y | X_k]) / Var(Y)` is
 *   the share of the variance removed by learning `X_k` alone. It is the share
 *   an additive model would attribute to `X_k`.
 * - The **total index** `S_T_k = E[Var(Y | X_~k)] / Var(Y)` is the share that
 *   remains when everything *except* `X_k` is fixed — `X_k`'s own effect plus
 *   every interaction it takes part in.
 *
 * `S_k ≤ S_T_k` always. `Σ_k S_k ≤ 1` with equality if and only if the model is
 * additive, and `Σ_k S_T_k ≥ 1` with equality under the same condition. So
 * `1 − Σ_k S_k` is the share of variance living in interactions, and
 * {@link SobolIndices.interactionShare} reports it: it is the number a tornado
 * chart cannot produce at any cost. A near-zero `S_T_k` is the one result here
 * that licenses *dropping* an input, which no OAT bar can justify.
 *
 * **The estimators, and why these two.** The definitions above are nested
 * expectations; evaluating them directly costs `N²`. The pick-and-freeze
 * construction gets both for `N(d + 2)` evaluations: draw two independent
 * `N × d` sample matrices `A` and `B` in the unit cube, and for each input `k`
 * form `A_B^k` — `A` with column `k` taken from `B`. Then, with
 * `f_A = f(A)`, `f_B = f(B)`, `f_k = f(A_B^k)`:
 *
 * ```
 * S_k   ≈ (1/N) Σ_i f_B,i (f_k,i − f_A,i) / V            (Saltelli et al. 2010)
 * S_T_k ≈ (1/2N) Σ_i (f_A,i − f_k,i)²     / V            (Jansen 1999)
 * ```
 *
 * Both were chosen on the evidence in Saltelli et al., *Variance based
 * sensitivity analysis of model output* (Comput. Phys. Commun. 181, 2010),
 * which compares the available estimators on the same samples: the first is
 * the best-performing first-order form there, and Jansen's is the best total
 * form. Two properties matter more than the ranking, and both are checked in
 * this module's tests rather than taken on the paper's word:
 *
 * - The first-order numerator is written as `f_B (f_k − f_A)` and **not** as
 *   `f_A f_k − mean²`. The differenced form avoids subtracting two large
 *   nearly equal numbers, which is what the product form does, and does worst
 *   exactly when the output's mean is large relative to its spread — a model
 *   whose output is a range in metres plus an offset is that case.
 *
 *   **The differenced form is not, on its own, invariant to an offset, and
 *   the first draft of this module said it was.** Under `f → f + c` the term
 *   becomes `f_B (f_k − f_A) + c (f_k − f_A)`, and the added part has mean
 *   zero only *in expectation*: in a finite sample it is `c` times the
 *   residual difference of two sample means, which at `c = 10⁶` against a
 *   spread of order 1 swamped the estimate entirely — measured `S₀ = 13.43`
 *   where the analytic value is `0.762`. The fix is to centre both samples on
 *   the pooled mean before forming any term, which this module does. Centring
 *   makes the invariance **exact** rather than asymptotic, because the pooled
 *   mean absorbs `c` by the same arithmetic that introduced it, and the test
 *   asserting it is a regression test for a claim that was once false here.
 * - Jansen's total form is a mean of squares, so it is **non-negative by
 *   construction**. The first-order estimator is not, and a small negative
 *   `S_k` is a legitimate estimate of a near-zero index rather than a bug. It
 *   is reported unclamped for that reason — clamping it to zero would hide the
 *   one signal that says `N` is too small to resolve that input.
 *
 * **The variance in the denominator** is the population variance of the pooled
 * `f_A ∪ f_B` sample (`2N` values, divided by `2N`). Pooling is what makes the
 * two indices share a denominator, without which their sums no longer bracket
 * 1 and the interaction share is not a share of anything.
 *
 * **Sampling, and what the reported standard error does and does not mean.**
 * The default sampler is the engine's scrambled Sobol' sequence
 * ({@link sobolUniform}), taken as one `2d`-dimensional low-discrepancy
 * sequence whose first `d` coordinates are `A` and whose last `d` are `B` —
 * the standard construction, and the reason this module is bounded to ten
 * inputs (the generator carries {@link MAX_SOBOL_DIMENSIONS} = 21 dimensions).
 *
 * The standard errors reported alongside each index are the plain i.i.d.
 * formula: each estimator is a mean over `i`, so its standard error is the
 * term-wise sample standard deviation over `√N`, divided by `V`. **That
 * formula is exact only under `sampling: "random"`.** A scrambled Sobol'
 * sample is deliberately *not* independent — that is the whole point of it —
 * and its true error is usually smaller, but "usually smaller" is an empirical
 * observation and not a bound, so the number is an indicator of scale and not
 * a confidence interval. The honest error bar under randomised QMC comes from
 * independent scrambles of the same sequence, which is filed as P0.113 rather
 * than done here. The `V` in the denominator is treated as known; its own
 * sampling error is not propagated.
 *
 * **Independence is an assumption, not a detail.** The variance decomposition
 * above is unique only for independent inputs. Every input here is drawn
 * independently in the unit cube, and a caller who maps those uniforms onto
 * correlated inputs inside {@link SobolIndexProblem.evaluate} gets numbers
 * that still sum the way the arithmetic says and mean nothing.
 *
 * **Censoring is fatal here, unlike in a tornado.** {@link ./tornado.js} can
 * report a censored bar and carry on because each bar stands alone. These
 * estimators are differences *between matched draws*: dropping one member of a
 * pair biases every index that pair contributes to, in a direction that
 * depends on where in input space the failures lie. So a `null` from
 * `evaluate` is counted, reported, and makes the whole result
 * {@link SobolIndices.censored} — and the indices are then conditional on the
 * output existing, which is not the quantity anyone asked for.
 */

import { PCG32, MAX_SOBOL_DIMENSIONS, sobolUniform } from "@ballista/engine";

/**
 * The largest number of inputs this module will place.
 *
 * The pick-and-freeze construction needs `2d` independent coordinates, and the
 * Sobol' generator carries {@link MAX_SOBOL_DIMENSIONS}. Ten is also well past
 * the point where `N(d + 2)` evaluations stops being cheap.
 */
export const MAX_SOBOL_INDEX_INPUTS = Math.floor(MAX_SOBOL_DIMENSIONS / 2);

/**
 * The problem indices are computed for.
 *
 * `evaluate` takes a point in the **open unit cube** `(0, 1)^d`, not in input
 * units. Folding each input's quantile into `evaluate` keeps this module to
 * one callback and makes the independence assumption above impossible to state
 * ambiguously: the cube's coordinates are independent by construction, and
 * what they are mapped to is the caller's business.
 */
export interface SobolIndexProblem {
  /** Input names, in the order `evaluate`'s argument uses. */
  readonly inputs: readonly string[];
  /**
   * The output at a point of the unit cube. Return `null` when the point has
   * no answer — see "Censoring" in the module header for why that is more
   * serious here than in a tornado.
   */
  evaluate(unitPoint: readonly number[]): number | null;
}

/** One input's pair of indices. */
export interface SobolIndex {
  /** The input's name, echoed from the problem. */
  readonly input: string;
  /** The input's position in the problem's own order. */
  readonly index: number;
  /**
   * `S_k` — the share of output variance explained by this input alone.
   * **Reported unclamped**: a small negative value is an estimate of a
   * near-zero index, and is the signal that `N` is too small to resolve it.
   */
  readonly first: number;
  /**
   * `S_T_k` — this input's own effect plus every interaction it appears in.
   * Non-negative by construction (Jansen's estimator is a mean of squares).
   */
  readonly total: number;
  /**
   * `S_T_k − S_k`, the share of variance this input carries only in
   * combination with others. Zero for an additive model; it is the quantity
   * {@link ./tornado.js} cannot see at any sample size.
   */
  readonly interaction: number;
  /** i.i.d. standard error of {@link first}. See the module header. */
  readonly firstStandardError: number;
  /** i.i.d. standard error of {@link total}. See the module header. */
  readonly totalStandardError: number;
}

/** The decomposition, plus what its sums say about the model. */
export interface SobolIndices {
  /** `N` — rows in each of `A` and `B`. */
  readonly baseSamples: number;
  /** `N(d + 2)` — evaluations requested. */
  readonly evaluations: number;
  /** Evaluations that returned `null`. */
  readonly failures: number;
  /** Whether any evaluation failed, in which case the indices are conditional. */
  readonly censored: boolean;
  /** Sample mean of the pooled `f_A ∪ f_B`. */
  readonly mean: number;
  /** Population variance of the pooled `f_A ∪ f_B` — the shared denominator. */
  readonly variance: number;
  /** One entry per input, in the problem's own order. */
  readonly indices: readonly SobolIndex[];
  /** `Σ_k S_k`. At most 1, with equality only for an additive model. */
  readonly firstOrderSum: number;
  /** `Σ_k S_T_k`. At least 1, with equality only for an additive model. */
  readonly totalSum: number;
  /**
   * `1 − Σ_k S_k` — the share of variance in interactions. Zero for an
   * additive model, and the headline result of this module.
   */
  readonly interactionShare: number;
}

/** Knobs for {@link sobolIndices}. */
export interface SobolIndexOptions {
  /**
   * `N`, rows per sample matrix. Default `4096`. Total cost is `N(d + 2)`
   * evaluations.
   *
   * Sobol' indices converge slowly, and the slowest is a small index measured
   * against a large variance: the estimator's error does not shrink because
   * the quantity does. Read {@link SobolIndex.firstStandardError} before
   * believing a small index rather than raising `N` by reflex.
   */
  readonly baseSamples?: number;
  /**
   * Scrambled Sobol' (default) or plain pseudo-random sampling.
   *
   * `"random"` is here because it is the only mode under which the reported
   * standard errors are the quantity their name says, which makes it the mode
   * a convergence study should use. `"sobol"` converges faster and is the
   * right default for a single answer.
   */
  readonly sampling?: "sobol" | "random";
  /** Seed for the scramble or the PCG32 stream. The same seed reproduces exactly. */
  readonly seed?: number;
}

const DEFAULT_BASE_SAMPLES = 4096;
const DEFAULT_SEED = 1;

/** Draws the `N × 2d` matrix of uniforms the construction is built from. */
function drawUniforms(
  baseSamples: number,
  dimension: number,
  sampling: "sobol" | "random",
  seed: number,
): number[][] {
  const rows: number[][] = [];
  if (sampling === "random") {
    const rng = new PCG32(BigInt(seed));
    for (let i = 0; i < baseSamples; i++) {
      const row = new Array<number>(2 * dimension);
      for (let j = 0; j < 2 * dimension; j++) {
        const u = rng.nextF64();
        // The problem contract is the *open* cube, and `nextF64` can return 0.
        row[j] = u > 0 ? u : Number.MIN_VALUE;
      }
      rows.push(row);
    }
    return rows;
  }
  for (let i = 0; i < baseSamples; i++) {
    const row = new Array<number>(2 * dimension);
    for (let j = 0; j < 2 * dimension; j++) {
      row[j] = sobolUniform(seed, i, j);
    }
    rows.push(row);
  }
  return rows;
}

/** Mean and population variance of a sample, in one pass over it. */
function momentsOf(values: readonly number[]): { mean: number; variance: number } {
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let m2 = 0;
  for (const v of values) {
    const d = v - mean;
    m2 += d * d;
  }
  return { mean, variance: m2 / values.length };
}

/** Mean and standard error of the mean of a term-wise sample. */
function meanAndStandardError(terms: readonly number[]): { mean: number; standardError: number } {
  const n = terms.length;
  let mean = 0;
  for (const t of terms) mean += t;
  mean /= n;
  if (n < 2) return { mean, standardError: 0 };
  let m2 = 0;
  for (const t of terms) {
    const d = t - mean;
    m2 += d * d;
  }
  // Bessel-corrected sample variance, then the standard error of its mean.
  const variance = m2 / (n - 1);
  return { mean, standardError: Math.sqrt(variance / n) };
}

/**
 * The P6.19 decomposition: first-order and total Sobol' indices for every
 * input, in `N(d + 2)` evaluations.
 *
 * @throws If there are no inputs, if there are more than
 *   {@link MAX_SOBOL_INDEX_INPUTS}, if `baseSamples` is not an integer of at
 *   least 2, if `seed` is not a non-negative integer, if any evaluation
 *   returns a non-finite number (return `null` for "no answer" instead, so it
 *   is counted as censoring rather than poisoning the moments), or if the
 *   pooled output variance is zero — a constant output has no variance to
 *   apportion and every index would be `0/0`.
 */
export function sobolIndices(
  problem: SobolIndexProblem,
  options: SobolIndexOptions = {},
): SobolIndices {
  const { inputs } = problem;
  const dimension = inputs.length;
  if (dimension === 0) {
    throw new Error("sobolIndices: no inputs; there is nothing to apportion variance to");
  }
  if (dimension > MAX_SOBOL_INDEX_INPUTS) {
    throw new Error(
      `sobolIndices: ${dimension} inputs; the pick-and-freeze construction needs 2d ` +
        `independent coordinates and the generator carries ${MAX_SOBOL_DIMENSIONS}, ` +
        `so at most ${MAX_SOBOL_INDEX_INPUTS} are supported`,
    );
  }

  const baseSamples = options.baseSamples ?? DEFAULT_BASE_SAMPLES;
  if (!Number.isInteger(baseSamples) || baseSamples < 2) {
    throw new Error(
      `sobolIndices: baseSamples ${baseSamples} is not an integer of at least 2; ` +
        "a variance needs two draws",
    );
  }
  const sampling = options.sampling ?? "sobol";
  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`sobolIndices: seed ${seed} is not a non-negative integer`);
  }

  const uniforms = drawUniforms(baseSamples, dimension, sampling, seed);

  let failures = 0;
  const evaluateAt = (point: readonly number[]): number | null => {
    const value = problem.evaluate(point);
    if (value === null) {
      failures += 1;
      return null;
    }
    if (!Number.isFinite(value)) {
      throw new Error(
        `sobolIndices: an evaluation returned ${value}; return null for a point with no ` +
          "answer, so it is counted as censoring rather than poisoning the moments",
      );
    }
    return value;
  };

  // f(A) and f(B): the two base samples.
  const fA = new Array<number | null>(baseSamples);
  const fB = new Array<number | null>(baseSamples);
  const pointA = new Array<number>(dimension);
  const pointB = new Array<number>(dimension);
  for (let i = 0; i < baseSamples; i++) {
    const row = uniforms[i]!;
    for (let k = 0; k < dimension; k++) {
      pointA[k] = row[k]!;
      pointB[k] = row[dimension + k]!;
    }
    fA[i] = evaluateAt(pointA);
    fB[i] = evaluateAt(pointB);
  }

  // The shared denominator, over the pooled A ∪ B sample. Censored draws are
  // excluded here as well as from the index sums; see the module header for
  // why that makes the whole result conditional rather than merely smaller.
  const pooled: number[] = [];
  for (let i = 0; i < baseSamples; i++) {
    if (fA[i] !== null) pooled.push(fA[i]!);
    if (fB[i] !== null) pooled.push(fB[i]!);
  }
  if (pooled.length < 2) {
    throw new Error(
      `sobolIndices: ${pooled.length} of ${2 * baseSamples} base draw(s) produced a value; ` +
        "a variance needs two",
    );
  }
  const { mean, variance } = momentsOf(pooled);
  if (variance === 0) {
    throw new Error(
      "sobolIndices: the pooled output variance is zero; a constant output has no variance " +
        "to apportion and every index would be 0/0",
    );
  }

  const indices: SobolIndex[] = [];
  let firstOrderSum = 0;
  let totalSum = 0;

  const pointK = new Array<number>(dimension);
  for (let k = 0; k < dimension; k++) {
    const firstTerms: number[] = [];
    const totalTerms: number[] = [];
    for (let i = 0; i < baseSamples; i++) {
      const a = fA[i]!;
      const b = fB[i]!;
      if (a === null || b === null) continue;
      const row = uniforms[i]!;
      // A_B^k: row i of A with column k taken from B.
      for (let j = 0; j < dimension; j++) pointK[j] = row[j]!;
      pointK[k] = row[dimension + k]!;
      const raw = evaluateAt(pointK);
      if (raw === null) continue;
      // Centre on the pooled mean before forming any term. This is what makes
      // the first-order estimator exactly invariant to an output offset rather
      // than only asymptotically so -- see the module header, where the
      // measurement that forced it is recorded.
      const ac = a - mean;
      const bc = b - mean;
      const fk = raw - mean;
      // Saltelli 2010 for S_k.
      firstTerms.push(bc * (fk - ac));
      // Jansen 1999 for S_T_k: a mean of squares, hence non-negative. The
      // centring cancels here, and is applied only so both estimators are
      // built from one set of numbers.
      const d = ac - fk;
      totalTerms.push((d * d) / 2);
    }
    if (firstTerms.length < 2) {
      throw new Error(
        `sobolIndices: input ${k} ("${inputs[k]!}") kept ${firstTerms.length} matched ` +
          "triple(s); the estimators are differences between matched draws and need two",
      );
    }

    const firstStat = meanAndStandardError(firstTerms);
    const totalStat = meanAndStandardError(totalTerms);
    const first = firstStat.mean / variance;
    const total = totalStat.mean / variance;
    firstOrderSum += first;
    totalSum += total;
    indices.push({
      input: inputs[k]!,
      index: k,
      first,
      total,
      interaction: total - first,
      firstStandardError: firstStat.standardError / variance,
      totalStandardError: totalStat.standardError / variance,
    });
  }

  return {
    baseSamples,
    evaluations: baseSamples * (dimension + 2),
    failures,
    censored: failures > 0,
    mean,
    variance,
    indices,
    firstOrderSum,
    totalSum,
    interactionShare: 1 - firstOrderSum,
  };
}
