/**
 * Reading the convergence *order* off a Newton solve's own residual history
 * (P5.19). The plot this feeds shows `log‖F‖` against iteration index, and
 * the thing it exists to make visible is the quadratic tail: near a simple
 * root Newton's method satisfies `‖F₍ₖ₊₁₎‖ ≈ C‖Fₖ‖²`, so each iteration buys
 * roughly twice as many correct digits as the one before.
 *
 * **Why the diagnostic is a ratio of slopes and not a fitted exponent.**
 * Write `Lₖ = log₁₀‖Fₖ‖`. Squaring the residual becomes doubling in log
 * space: `L₍ₖ₊₁₎ = 2Lₖ + c` with `c = log₁₀ C`. The slope of the plotted
 * curve between consecutive points is `sₖ = L₍ₖ₊₁₎ − Lₖ = Lₖ + c`, and so
 *
 *     s₍ₖ₊₁₎ = L₍ₖ₊₂₎ − L₍ₖ₊₁₎ = (2L₍ₖ₊₁₎ + c) − L₍ₖ₊₁₎ = L₍ₖ₊₁₎ + c
 *            = 2Lₖ + 2c = 2 sₖ.
 *
 * The ratio is exactly 2 for exact quadratic convergence and — this is the
 * useful part — the unknown constant `C` cancels out of it. A least-squares
 * fit of `p` in `‖F₍ₖ₊₁₎‖ = C‖Fₖ‖^p` would need `C` and would be dominated by
 * the early, pre-asymptotic iterations; the ratio of the last two slopes uses
 * only the three residuals nearest the root, which is exactly where the
 * asymptotic law is the one in force. Hence
 * {@link finalMeritSlopeRatio}'s three-point window.
 *
 * **What this is not.** A linearly convergent method gives a constant slope
 * and therefore a ratio near 1; a stalled or diverging solve gives whatever
 * the noise gives. The ratio is a diagnostic to display and assert on, not a
 * convergence test — {@link NewtonShootingResult.converged} is that.
 */

/** One `(iteration, ‖F‖)` sample of a solve's residual history, oldest first. */
export interface NewtonTracePoint {
  /** Newton iteration index this residual was measured at. */
  readonly iteration: number;
  /** `‖F‖` — the miss distance, in metres, at that iterate. */
  readonly merit: number;
}

/**
 * Below this, a slope is treated as too small to divide by. Two consecutive
 * residuals equal to the last digit — which a rejected step (`α = 0`) produces
 * exactly, since the iterate did not move — give a slope of 0, and a ratio
 * against it is `±∞` or `NaN` rather than a measurement.
 */
const MIN_SLOPE = 1e-12;

/**
 * Keeps only the points a log axis can actually show: `‖F‖` must be finite and
 * strictly positive.
 *
 * A converged solve can report `‖F‖ = 0` when the aim lands on the target to
 * the last bit, and `log 0` is `−∞`, which poisons both the plot and every
 * slope computed through it. Dropping the point is the honest option: the plot
 * cannot render "infinitely many correct digits", and a clamp would draw a
 * finite value the solve never produced.
 */
export function plottableTracePoints(
  points: readonly NewtonTracePoint[],
): readonly NewtonTracePoint[] {
  return points.filter((point) => Number.isFinite(point.merit) && point.merit > 0);
}

/**
 * Slopes of `log₁₀‖F‖` between consecutive plottable points — `n` points give
 * `n − 1` slopes, each negative while the solve is converging.
 *
 * These are the slopes of the segments the plot actually draws, so a reader
 * comparing the printed numbers against the picture is comparing one
 * measurement with itself.
 */
export function meritLogSlopes(points: readonly NewtonTracePoint[]): readonly number[] {
  const usable = plottableTracePoints(points);
  const slopes: number[] = [];
  for (let i = 1; i < usable.length; i += 1) {
    slopes.push(Math.log10(usable[i]!.merit) - Math.log10(usable[i - 1]!.merit));
  }
  return slopes;
}

/**
 * Ratios of consecutive slopes — `n` slopes give `n − 1` ratios, each ≈ 2
 * once the solve is in its quadratic regime.
 *
 * A ratio whose denominator is smaller than {@link MIN_SLOPE} is omitted
 * rather than reported as a large number: it means the residual did not move
 * between those two iterates, which is a stalled step, not fast convergence.
 */
export function meritSlopeRatios(points: readonly NewtonTracePoint[]): readonly number[] {
  const slopes = meritLogSlopes(points);
  const ratios: number[] = [];
  for (let i = 1; i < slopes.length; i += 1) {
    const previous = slopes[i - 1]!;
    if (Math.abs(previous) < MIN_SLOPE) continue;
    ratios.push(slopes[i]! / previous);
  }
  return ratios;
}

/**
 * The observed slope ratio over the **last three** residuals — the
 * quantity P5.19's validation criterion asserts, and the one displayed
 * alongside the plot.
 *
 * Three residuals give two slopes and one ratio. Returns `undefined` when
 * there are fewer than three plottable points, or when the earlier of the two
 * slopes is too small to divide by; both mean "no measurement", which a caller
 * must show as such rather than as a number.
 *
 * Expect ≈ 2 for a Newton solve that reached its asymptotic regime, ≈ 1 for a
 * linearly convergent one, and anything at all for a solve that stalled — see
 * the module docstring.
 */
export function finalMeritSlopeRatio(points: readonly NewtonTracePoint[]): number | undefined {
  const usable = plottableTracePoints(points);
  if (usable.length < 3) return undefined;
  const lastThree = usable.slice(-3);
  const first = Math.log10(lastThree[1]!.merit) - Math.log10(lastThree[0]!.merit);
  if (Math.abs(first) < MIN_SLOPE) return undefined;
  const second = Math.log10(lastThree[2]!.merit) - Math.log10(lastThree[1]!.merit);
  return second / first;
}
