/**
 * One-at-a-time (OAT) tornado chart of parameter influence (P6.18).
 *
 * **What it is.** Hold every input at its nominal value, move one of them to
 * `μ_k ± c σ_k`, and record where the output goes. Do that for each input in
 * turn, sort the resulting intervals by width, and the picture is a tornado:
 * the widest bar on top, tapering downward. It costs `2n` solves for `n`
 * inputs — the cheapest honest answer to "which input matters most", and the
 * one a reader can check by hand.
 *
 * **How it relates to the first-order spread.** {@link ./first-order-sensitivity.js}'s
 * `firstOrderSpread` already returns `contributions = |∂R/∂μ_k| σ_k`, and
 * P6.18's criterion is that the bar order matches that ranking. The two are
 * the *same quantity computed two ways*, and the difference between the ways
 * is the whole content of this module:
 *
 * - `|∂R/∂μ_k| σ_k` is a **derivative** — the response's slope exactly at the
 *   nominal point, scaled by σ. It knows nothing about what happens a finite
 *   distance away.
 * - A bar's half-span `|R(+cσ_k) − R(−cσ_k)| / 2` is a **central difference**
 *   over a finite interval, and equals `c |∂R/∂μ_k| σ_k + O(c³ σ_k³ R''')`.
 *
 * So for a response that is linear over `±cσ` the two agree exactly, and the
 * rankings are identical. Where they disagree, the disagreement is curvature
 * over the interval the input actually spans — which is the same condition
 * P6.17 measures, arrived at from the other side, and is why
 * {@link compareTornadoToFirstOrder} reports *which pairs* swapped rather than
 * only whether anything did.
 *
 * **Two things a tornado chart cannot tell you, and neither is visible in the
 * picture.**
 *
 * 1. **Interactions.** Moving one input while the others sit at nominal
 *    explores `2n` points, all of them on the axes through the nominal point.
 *    A response whose sensitivity to θ depends on `v₀` has a ridge that no
 *    axis passes along, and OAT will report the sensitivity at one particular
 *    `v₀` as though it were the sensitivity. This is not a resolution problem
 *    that more points fix — it is the method's shape. P6.19's Sobol' total
 *    indices exist precisely to fill it.
 * 2. **Combination.** Bars are readable individually and do **not** add up to
 *    the output's spread. The first-order spread combines the same
 *    contributions in quadrature: half-spans of 3 and 4 give a σ_R of 5, not 7,
 *    and a reader who sums the bars overstates the total.
 *
 * **Asymmetry is reported, not averaged away.** `R(+cσ) − R(μ₀)` and
 * `R(μ₀) − R(−cσ)` are equal only for a locally linear response. The bar is
 * drawn from the pair, but {@link TornadoBar.asymmetry} keeps the difference
 * visible, because it is the cheapest curvature signal available here — it
 * costs nothing beyond the two solves already done, and a large value is the
 * warning that this bar's ranking against its neighbours is not to be trusted.
 *
 * **Censoring.** An input can be moved to a value at which the problem has no
 * answer — a shot that never lands, a solve that fails. Such a bar has no
 * span, so it is reported with `span: null` and sorted to the end rather than
 * being given a span of zero, which would rank it as the *least* influential
 * input when in fact it is the one that broke the problem. A tornado with any
 * censored bar is flagged, and its order is not a ranking.
 */

/**
 * The problem a tornado is drawn for.
 *
 * `evaluate` takes displacements from the nominal point, in input order — the
 * same convention as
 * {@link ./first-order-sensitivity.js}'s `UncertainOutputProblem`, so a caller
 * holding one can pass it straight in.
 */
export interface TornadoProblem {
  /** Input names, in the order `sigmas` and `evaluate` use. */
  readonly inputs: readonly string[];
  /**
   * The half-width each input is moved by. Zero is allowed and produces a
   * zero-width bar; negative is not.
   */
  readonly sigmas: readonly number[];
  /**
   * The output at the nominal point displaced by `delta` (one per input).
   * Return `null` when the displaced problem has no answer, rather than
   * throwing or returning a sentinel — see "Censoring" in the module header.
   */
  evaluate(delta: readonly number[]): number | null;
}

/** One input's bar. */
export interface TornadoBar {
  /** The input's name, echoed from the problem. */
  readonly input: string;
  /** The input's position in the problem's own order, which sorting does not disturb. */
  readonly index: number;
  /** `R(μ₀ − c σ_k)`, or `null` if that point has no answer. */
  readonly low: number | null;
  /** `R(μ₀ + c σ_k)`, or `null` if that point has no answer. */
  readonly high: number | null;
  /**
   * `|high − low|` — the bar's length, and what the tornado is sorted by.
   * `null` when either endpoint is censored.
   */
  readonly span: number | null;
  /**
   * `span / 2`. For a locally linear response this is exactly
   * `c |∂R/∂μ_k| σ_k`, the first-order contribution — which is what makes the
   * ranking comparison in {@link compareTornadoToFirstOrder} a comparison of
   * like with like rather than of a length against a derivative.
   */
  readonly halfSpan: number | null;
  /** `low − R(μ₀)`, or `null` if censored. */
  readonly lowShift: number | null;
  /** `high − R(μ₀)`, or `null` if censored. */
  readonly highShift: number | null;
  /**
   * `|highShift + lowShift| / span` — the cheapest curvature signal available
   * from the two solves the bar already cost. Zero for a response that is
   * linear over the bar, because the two shifts then cancel exactly.
   *
   * **It is not bounded by 1.** The numerator is a sum of shifts and the
   * denominator their difference, so once the bar straddles a local extremum
   * and both endpoints move the *same* way, the denominator collapses while
   * the numerator does not. Measured on the drag-free range at
   * `θ₀ = 45° − 0.06` with `σ_θ = 0.05`: 0.415 at `scale = 1`, and **3.506**
   * at `scale = 8`, where the interval has crossed the apex. Read it as "how
   * far from linear", not as a fraction — and read anything above about 1
   * together with {@link monotone}, which is what says the bar has folded.
   *
   * `null` when censored, and `0` when the span is zero.
   */
  readonly asymmetry: number | null;
  /**
   * Whether the two endpoints fall on opposite sides of the nominal, i.e.
   * whether the response is monotone across the bar. `false` at a local
   * extremum, where both endpoints move the same way and the bar's *centre*,
   * not its width, is the interesting quantity — a case a tornado chart
   * renders identically to a monotone bar and so cannot show.
   */
  readonly monotone: boolean;
  /** Whether either endpoint had no answer. */
  readonly censored: boolean;
}

/** The chart: bars widest-first, plus what the ordering is and is not. */
export interface Tornado {
  /** `R(μ₀)` — every shift is measured from here. */
  readonly nominal: number;
  /** The multiplier applied to every σ. */
  readonly scale: number;
  /**
   * Bars sorted by decreasing {@link TornadoBar.span}. Ties break by input
   * index, so the order is a deterministic function of the inputs and not of
   * the sort's internals. Censored bars come last, in input order.
   */
  readonly bars: readonly TornadoBar[];
  /** Input indices in bar order — the ranking, extracted for comparison. */
  readonly order: readonly number[];
  /** Whether any bar was censored, in which case {@link order} is not a ranking. */
  readonly censored: boolean;
}

/** Knobs for {@link oneAtATimeTornado}. */
export interface TornadoOptions {
  /**
   * Multiplier on each σ: each input is moved to `±scale × σ_k`. Default `1`.
   *
   * It is a knob rather than a constant because the answer depends on it: a
   * tornado is a statement about the response over a particular interval, and
   * "which input matters most" can genuinely change with the interval's width
   * on a nonlinear response. A caller comparing against the first-order
   * ranking should keep it small; a caller asking "what could plausibly
   * happen" wants 2 or 3.
   */
  readonly scale?: number;
}

const DEFAULT_SCALE = 1;

/**
 * The P6.18 chart: `2n` evaluations, one input moved at a time.
 *
 * @throws If the problem's arrays disagree in length, if there are no inputs,
 *   if any σ is negative or not finite, if `scale` is not finite and positive,
 *   or if the nominal point itself has no answer — every shift here is
 *   measured from it.
 */
export function oneAtATimeTornado(problem: TornadoProblem, options: TornadoOptions = {}): Tornado {
  const { inputs, sigmas } = problem;
  if (inputs.length !== sigmas.length) {
    throw new Error(
      `oneAtATimeTornado: ${inputs.length} input name(s) against ${sigmas.length} sigma(s); ` +
        "they index the same inputs and must have the same length",
    );
  }
  if (inputs.length === 0) {
    throw new Error("oneAtATimeTornado: no inputs; there is nothing to rank");
  }
  for (let k = 0; k < sigmas.length; k++) {
    const s = sigmas[k]!;
    if (!Number.isFinite(s) || s < 0) {
      throw new Error(`oneAtATimeTornado: sigma ${k} is ${s}; it must be finite and non-negative`);
    }
  }

  const scale = options.scale ?? DEFAULT_SCALE;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`oneAtATimeTornado: scale ${scale} is not a finite positive multiplier`);
  }

  const delta = new Array<number>(inputs.length).fill(0);
  const nominal = problem.evaluate(delta);
  if (nominal === null || !Number.isFinite(nominal)) {
    throw new Error(
      `oneAtATimeTornado: the nominal point evaluated to ${nominal}; every bar here is ` +
        "measured from it, so there is nothing to draw",
    );
  }

  const bars: TornadoBar[] = [];
  let censoredAny = false;

  for (let k = 0; k < inputs.length; k++) {
    const half = scale * sigmas[k]!;

    delta[k] = -half;
    const low = finiteOrNull(problem.evaluate(delta), inputs[k]!, "low");
    delta[k] = half;
    const high = finiteOrNull(problem.evaluate(delta), inputs[k]!, "high");
    delta[k] = 0; // restore before the next input — this is what makes it one-at-a-time

    const censored = low === null || high === null;
    if (censored) censoredAny = true;

    const span = censored ? null : Math.abs(high! - low!);
    const lowShift = low === null ? null : low - nominal;
    const highShift = high === null ? null : high - nominal;

    let asymmetry: number | null = null;
    if (!censored) {
      asymmetry = span === 0 ? 0 : Math.abs(highShift! + lowShift!) / span!;
    }

    bars.push({
      input: inputs[k]!,
      index: k,
      low,
      high,
      span,
      halfSpan: span === null ? null : span / 2,
      lowShift,
      highShift,
      asymmetry,
      // Strictly opposite signs. A zero shift on either side is not monotone
      // movement, and neither is a bar at a local extremum where both
      // endpoints go the same way.
      monotone:
        !censored && ((lowShift! < 0 && highShift! > 0) || (lowShift! > 0 && highShift! < 0)),
      censored,
    });
  }

  // Widest first; censored last; ties by input index so the order is a
  // function of the data rather than of the sort's stability.
  const sorted = [...bars].sort((a, b) => {
    if (a.span === null && b.span === null) return a.index - b.index;
    if (a.span === null) return 1;
    if (b.span === null) return -1;
    if (a.span !== b.span) return b.span - a.span;
    return a.index - b.index;
  });

  return {
    nominal,
    scale,
    bars: sorted,
    order: sorted.map((bar) => bar.index),
    censored: censoredAny,
  };
}

function finiteOrNull(value: number | null, input: string, side: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    throw new Error(
      `oneAtATimeTornado: the ${side} endpoint of input "${input}" evaluated to ${value}; ` +
        "return null for a displaced point with no answer, so it is counted as censoring " +
        "rather than sorted as though it were a number",
    );
  }
  return value;
}

/** How a tornado's order compares to the `|∂R/∂μ_k| σ_k` ranking — P6.18's criterion. */
export interface TornadoRankingAgreement {
  /** Input indices in bar order. */
  readonly tornadoOrder: readonly number[];
  /** Input indices ordered by decreasing first-order contribution, ties by index. */
  readonly firstOrderOrder: readonly number[];
  /** Whether the two orders are identical — the criterion, stated plainly. */
  readonly identical: boolean;
  /**
   * Kendall's tau-b over the `n(n−1)/2` input pairs, comparing each pair's
   * relative order under the two measures. `1` is perfect agreement, `−1` a
   * perfect reversal, `0` no better than chance. Reported alongside
   * {@link identical} because a single adjacent swap between two
   * near-indistinguishable inputs and a wholesale reordering both make
   * `identical` false, and they are not the same finding.
   *
   * Tau-**b**, so pairs tied under either measure are handled rather than
   * counted as agreement: a zero-σ input ties with every other zero-σ input,
   * and there is no fact about their relative order to agree on.
   */
  readonly kendallTau: number;
  /**
   * The input index pairs the two measures order differently, each as
   * `[a, b]` with `a < b` in input order. Empty exactly when the two agree on
   * every resolvable pair.
   */
  readonly discordantPairs: readonly (readonly [number, number])[];
}

/**
 * Compares a tornado's ordering against the first-order contributions
 * `|∂R/∂μ_k| σ_k` — the P6.18 validation, as a measurement rather than an
 * assertion.
 *
 * The comparison is on **half-spans against contributions**, both of which are
 * "this input's influence in output units", not on the raw bar length against
 * a derivative. With `scale = 1` and a locally linear response they are equal;
 * the ranking is what is compared, so a uniform scale factor is harmless and
 * the caller's `scale` need not be 1.
 *
 * @param tornado From {@link oneAtATimeTornado}.
 * @param contributions `FirstOrderSpread.contributions`, in the problem's input order.
 * @throws If the lengths disagree, if any contribution is not finite or is
 *   negative, or if the tornado is censored — a censored tornado has no
 *   ranking to compare.
 */
export function compareTornadoToFirstOrder(
  tornado: Tornado,
  contributions: readonly number[],
): TornadoRankingAgreement {
  if (tornado.bars.length !== contributions.length) {
    throw new Error(
      `compareTornadoToFirstOrder: ${tornado.bars.length} bar(s) against ` +
        `${contributions.length} contribution(s); they index the same inputs`,
    );
  }
  if (tornado.censored) {
    throw new Error(
      "compareTornadoToFirstOrder: the tornado has a censored bar, so its order is not a " +
        "ranking and there is nothing to compare it against",
    );
  }
  for (let k = 0; k < contributions.length; k++) {
    const c = contributions[k]!;
    if (!Number.isFinite(c) || c < 0) {
      throw new Error(
        `compareTornadoToFirstOrder: contribution ${k} is ${c}; ` +
          "|dR/dmu| sigma is finite and non-negative by construction",
      );
    }
  }

  // Half-spans back in input order, so both measures are indexed alike.
  const halfSpans = new Array<number>(tornado.bars.length).fill(0);
  for (const bar of tornado.bars) halfSpans[bar.index] = bar.halfSpan!;

  const firstOrderOrder = rankOrder(contributions);

  let concordant = 0;
  let discordant = 0;
  let tiedTornado = 0;
  let tiedFirstOrder = 0;
  const discordantPairs: (readonly [number, number])[] = [];

  for (let a = 0; a < halfSpans.length; a++) {
    for (let b = a + 1; b < halfSpans.length; b++) {
      const t = Math.sign(halfSpans[a]! - halfSpans[b]!);
      const f = Math.sign(contributions[a]! - contributions[b]!);
      if (t === 0) tiedTornado++;
      if (f === 0) tiedFirstOrder++;
      if (t === 0 || f === 0) continue;
      if (t === f) {
        concordant++;
      } else {
        discordant++;
        discordantPairs.push([a, b] as const);
      }
    }
  }

  const pairs = (halfSpans.length * (halfSpans.length - 1)) / 2;
  const denominator = Math.sqrt((pairs - tiedTornado) * (pairs - tiedFirstOrder));
  const kendallTau = denominator === 0 ? 0 : (concordant - discordant) / denominator;

  const tornadoOrder = [...tornado.order];
  return {
    tornadoOrder,
    firstOrderOrder,
    identical:
      tornadoOrder.length === firstOrderOrder.length &&
      tornadoOrder.every((value, i) => value === firstOrderOrder[i]),
    kendallTau,
    discordantPairs,
  };
}

/** Indices ordered by decreasing magnitude, ties by index — the same rule the bars use. */
function rankOrder(values: readonly number[]): number[] {
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (a.value !== b.value ? b.value - a.value : a.index - b.index))
    .map((entry) => entry.index);
}
