import { type ArcLabel, type ArcOptions, type ArcPair, solveArcs } from "./arcs.js";
import { PLANAR_LAYOUT, type TrajectoryLayout } from "./observables.js";
import {
  type ResidualFunction,
  type ShootingProblem,
  createShootingResidual,
} from "./shooting-residual.js";

/**
 * The ill-conditioning exhibit of §7 Phase 5 (P5.23): what happens to the
 * fixed-speed aim problem as the target creeps up on the reachability envelope.
 *
 * **Which Jacobian this is about, because the obvious one is the wrong one.**
 * P5.05's `shootingJacobian` differentiates the residual with respect to the
 * full aim `(θ, v₀)`, and that matrix is rank 1 for *every* aim: a
 * ground-impact terminal event pins the impact height, so the vertical row is
 * structurally zero (measured there at `<1e-8`). Its condition number is
 * therefore astronomical everywhere — around `1e11` — and it stays astronomical
 * a kilometre inside the envelope and a millimetre outside it alike. Plotting
 * it against envelope proximity draws a flat line. It is a fact about the
 * *terminal event*, not about the envelope.
 *
 * The degeneracy the blueprint means (§ "Globalization": *"the envelope is a
 * fold: the two solution arcs merge and det J → 0"*) lives one level down, in
 * the problem P5.08 actually solves: **fixed launch speed, one unknown `θ`, one
 * equation `R(θ) = R*`.** There the Jacobian is the `1 × 1` matrix `∂R/∂θ`,
 * `det J` is that single number, and it genuinely does go to zero — because the
 * envelope *is* the maximum of `R(θ)`, and the derivative of a smooth function
 * at its maximum is zero by definition. Free `v₀` as well and there is no fold
 * at all: a target past the envelope at one speed is simply reached at a higher
 * one.
 *
 * **The rate is the content, and it is a square root.** Near a simple
 * (quadratic) maximum,
 *
 * $$R(\theta) \approx R_{\max} - \tfrac12 |R''| (\theta - \theta_p)^2,$$
 *
 * so a target short of the envelope by `s = R_max − R*` is hit at
 * `θ± = θ_p ± √(2s/|R''|)`, and three things follow at once:
 *
 * | quantity                       | behaviour as `s → 0` |
 * | ------------------------------ | -------------------- |
 * | `det J = ∂R/∂θ` at the root    | `∓√(2|R''| s)`, i.e. `s^{+1/2}` |
 * | sensitivity `|∂θ/∂R| = 1/|det J|` | `s^{-1/2}` |
 * | arc separation `θ₊ − θ₋`        | `2√(2s/|R''|)`, i.e. `s^{+1/2}` |
 *
 * **so the spike is not merely "large near the envelope", it is a −1/2 power
 * law**, and that is what `ill-conditioning.test.ts` measures: a log-log fit of
 * sensitivity against shortfall, with drag on, where no closed form exists to
 * agree with. Halving the shortfall multiplies the condition number by only
 * `√2` — the blow-up is real but gentle, which is exactly why it is worth
 * quantifying rather than hand-waving. Getting within `1e-6` of the envelope
 * costs three orders of magnitude of accuracy, not fifteen.
 *
 * Drag-free the whole thing is closed-form and the tests use it as an external
 * reference: `R = (v₀²/g) sin 2θ` gives `∂R/∂θ = (2v₀²/g) cos 2θ` exactly, and
 * the root satisfies `sin 2θ = g·R_target / v₀²`, so the measured slope has an
 * analytic value to be checked against at every sampled target rather than only
 * asymptotically. (Written with `R_target` rather than the `R*` used elsewhere
 * in this file: `R*` followed by a slash would close this comment.)
 *
 * **What this module does not do: fix it.** The Levenberg–Marquardt fallback
 * the blueprint pairs with this observation is P5.26, and multi-start is P5.27.
 * P5.23's criterion is that the spike is exhibited and that *the solver warns* —
 * so {@link solveArcsWithConditioning} is a reporting wrapper around
 * {@link solveArcs}, not a replacement for it. Nothing here changes an answer.
 */

/**
 * How badly conditioned a fixed-speed solve is, as a three-level judgement
 * rather than a raw number.
 *
 * A bare number is not actionable on its own, so the levels are pinned to
 * decades of the relative condition number — significant digits lost — and
 * {@link CONDITION_NUMBER_THRESHOLDS} says what each costs.
 */
export type ConditioningLevel = "well-conditioned" | "ill-conditioned" | "at-fold";

/**
 * Thresholds separating the {@link ConditioningLevel}s, in units of the
 * **dimensionless relative condition number** — percent of aim error per
 * percent of target error.
 *
 * **Decades, read as digits lost**, which is what a condition number is for:
 * `κ` multiplies the relative error in the data to bound the relative error in
 * the answer, so `κ ≈ 10^d` costs about `d` significant digits.
 *
 * - `ill-conditioned` at **10** — one digit gone.
 * - `at-fold` at **100** — two or more, and the two arcs have closed to within
 *   a few degrees of each other.
 *
 * The baseline these sit above is not arbitrary either: drag-free the relative
 * condition number of this problem is exactly `tan(2θ)/(2θ)`, which is **1** at
 * zero elevation and rises monotonically to infinity at the 45° peak. So `κ ≈ 1`
 * is what a well-posed shot *is* here, and a threshold of 10 means "an order of
 * magnitude worse than a flat shot", not a number picked to make a plot look
 * busy.
 *
 * Exported so a caller can re-derive the level against its own tolerance for
 * lost digits rather than inheriting these.
 */
export const CONDITION_NUMBER_THRESHOLDS: Readonly<Record<"illConditioned" | "atFold", number>> =
  Object.freeze({
    illConditioned: 10,
    atFold: 100,
  });

/**
 * The step used to difference `R(θ)` when the caller does not override it,
 * in radians.
 *
 * **`1e-4`, sized against the integrator's noise floor rather than against
 * `√ε`.** `R(θ)` is the output of an adaptive solve, so the same reasoning as
 * `shooting-jacobian.ts` applies: differencing at `1e-8` measures the error
 * controller's step-sequence noise instead of the physics. This is the same
 * step `basin-of-attraction.ts` uses to read the sign of `∂R/∂θ`, and for the
 * same reason.
 *
 * There is a second reason to keep it here rather than shrink it. Near the fold
 * the *curvature* is what a central difference truncates against, and its error
 * is `⅙ R''' h²`; with `R'` itself going to zero like `√s`, the relative error
 * of the slope grows as the fold is approached no matter what `h` is. That is
 * not a defect of the difference — it is the conditioning this module exists to
 * report, showing up in the measurement of itself.
 */
export const DEFAULT_SLOPE_STEP = 1e-4;

/** Tuning for {@link assessConditioning} and {@link solveArcsWithConditioning}. */
export interface ConditioningOptions extends ArcOptions {
  /** Central-difference step in `θ`, radians. Defaults to {@link DEFAULT_SLOPE_STEP}. */
  readonly slopeStep?: number;
}

/** The conditioning of one solved arc. */
export interface ArcConditioning {
  /** Which arc this measures. */
  readonly arc: ArcLabel;
  /** The solved elevation, radians. */
  readonly theta: number;
  /**
   * `∂R/∂θ` at that elevation, metres per radian — the fixed-speed problem's
   * `det J`. Negative on the high arc, positive on the low one: the two arcs
   * sit on opposite sides of the peak, so the sign is the arc's identity and is
   * not folded into an absolute value here.
   *
   * `null` when the difference could not be taken because a perturbed
   * elevation had no impact at all.
   */
  readonly slope: number | null;
  /**
   * `|∂θ/∂R| = 1/|slope|`, radians of aim per metre of target — the quantity
   * the thresholds are stated in, and the one that diverges at the fold.
   *
   * `Infinity` at an exactly zero slope; `null` when {@link slope} is.
   */
  readonly sensitivity: number | null;
  /**
   * The dimensionless relative condition number of the root — how many percent
   * the elevation moves per percent the target moves,
   * `|∂θ/∂R| · R_target / θ`. **This is the quantity
   * {@link CONDITION_NUMBER_THRESHOLDS} judges**, because a bare
   * `rad/m` sensitivity is scale-dependent: the same well-posed shot reads
   * `1.5e-3` at 60 m/s and something else entirely at 600 m/s, so no absolute
   * threshold can separate "ordinary" from "at the fold" across problems. The
   * relative number does, and drag-free it has the closed form `tan(2θ)/(2θ)`,
   * equal to 1 at zero elevation and divergent at the 45° peak.
   *
   * `null` when {@link slope} is, and in the one degenerate case `θ = 0`, where
   * relative error in an angle of zero has no meaning. That case is not
   * ill-conditioned — see {@link level}.
   */
  readonly relativeConditionNumber: number | null;
  /**
   * The level {@link relativeConditionNumber} falls in.
   *
   * When the relative number is `null` *because* `θ = 0` — a raised launcher
   * whose target sits at exactly the zero-elevation range — the level is
   * decided directly from the slope instead, and a finite non-zero slope means
   * `"well-conditioned"`. A fold requires `∂R/∂θ → 0`; a root with a healthy
   * slope is not at one, whatever the relative measure can or cannot say about
   * it. When the slope itself could not be measured, the level is `"at-fold"`.
   */
  readonly level: ConditioningLevel;
}

/** What {@link solveArcsWithConditioning} returns. */
export interface ConditionedArcPair {
  /** The unmodified {@link solveArcs} answer. Nothing here changes it. */
  readonly arcs: ArcPair;
  /** Conditioning of the low arc, or `null` if there was no low solution. */
  readonly low: ArcConditioning | null;
  /** Conditioning of the high arc, or `null` if there was no high solution. */
  readonly high: ArcConditioning | null;
  /**
   * How far short of this speed's envelope the target sits, metres:
   * `maxDownrange − targetDownrange`. Zero at the fold, negative beyond it.
   *
   * This is the abscissa the `s^{-1/2}` law is stated against, and it is
   * *signed* on purpose — `solveArcs` reports an unreachable target's
   * `shortfall` as a positive overshoot, which would put both sides of the
   * envelope at the same abscissa and fold the plot back on itself.
   */
  readonly envelopeMargin: number;
  /**
   * `θ_high − θ_low`, radians, or `null` unless both arcs exist. Vanishes like
   * `√(envelopeMargin)` — the geometric face of the same fold.
   */
  readonly arcSeparation: number | null;
  /** The worse of the two arcs' levels; `"at-fold"` if the target is unreachable. */
  readonly level: ConditioningLevel;
  /**
   * A one-line human-readable warning, or `null` when
   * {@link level} is `"well-conditioned"`.
   *
   * **This is the "solver warns" half of P5.23's criterion.** It names the
   * measured sensitivity and what it costs, because "ill-conditioned" alone
   * tells a caller nothing they can act on.
   */
  readonly warning: string | null;
  /** Trajectory integrations spent, `solveArcs`' own included. */
  readonly evaluations: number;
}

/** One row of {@link sweepEnvelopeConditioning}. */
export interface ConditioningSample extends ConditionedArcPair {
  /** The target downrange this row solved for, metres from the launch point. */
  readonly targetDownrange: number;
}

/** What {@link sweepEnvelopeConditioning} returns. */
export interface ConditioningSweep {
  /** One row per requested target, in the order requested. */
  readonly samples: readonly ConditioningSample[];
  /** This speed's envelope, metres — the maximum downrange over all elevations. */
  readonly maxDownrange: number;
  /** The maximum-range elevation, radians. */
  readonly peakAngle: number;
  /** Total trajectory integrations spent. */
  readonly evaluations: number;
}

/**
 * Which coordinate of a position vector is downrange, for a given layout.
 *
 * The same one-line rule `arcs.ts`, `shooting-residual.ts` and `smart-init.ts`
 * each state privately; P0.91 is filed to consolidate all of them into
 * `observables.ts`, and this is the fifth copy rather than a fifth *rule*.
 * Duplicated here rather than fixed in passing because P0.91 is that task and
 * this one is P5.23. `ill-conditioning.test.ts` pins it against `arcs.ts`'s
 * behaviour so the copies cannot drift before P0.91 lands.
 */
function downrangeAxisOf(layout: TrajectoryLayout): number {
  return layout.vertical === 0 ? 1 : 0;
}

/**
 * Classify a relative condition number against
 * {@link CONDITION_NUMBER_THRESHOLDS}.
 *
 * `slope` is consulted only when `conditionNumber` is `null`, which happens for
 * an unmeasurable slope (`"at-fold"` — the perturbed aims left the reachable
 * set, which is what being at the boundary looks like) and for the `θ = 0`
 * degeneracy of the relative measure (decided by the slope, since a fold is a
 * vanishing slope and nothing else).
 */
export function conditioningLevel(
  conditionNumber: number | null,
  slope: number | null = null,
): ConditioningLevel {
  if (conditionNumber === null || !Number.isFinite(conditionNumber)) {
    if (conditionNumber === null && slope !== null && Number.isFinite(slope) && slope !== 0) {
      return "well-conditioned";
    }
    return "at-fold";
  }
  if (conditionNumber >= CONDITION_NUMBER_THRESHOLDS.atFold) {
    return "at-fold";
  }
  if (conditionNumber >= CONDITION_NUMBER_THRESHOLDS.illConditioned) {
    return "ill-conditioned";
  }
  return "well-conditioned";
}

/** The worse of two levels. */
function worseLevel(a: ConditioningLevel, b: ConditioningLevel): ConditioningLevel {
  const rank: Record<ConditioningLevel, number> = {
    "well-conditioned": 0,
    "ill-conditioned": 1,
    "at-fold": 2,
  };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * `∂R/∂θ` at one elevation, by central difference on the real trajectory.
 *
 * Returns `null` rather than throwing when either perturbed elevation fails to
 * reach an impact — the same contract as {@link ResidualFunction} and for the
 * same reason: a sweep that walks up to the envelope will step past it, and
 * that is an ordinary incident rather than a caller error.
 *
 * **A zero flight time is rejected as hard as a failed solve, and that guard is
 * load-bearing rather than defensive boilerplate.** A shot launched from
 * *exactly* ground level has the impact event satisfied at `t = 0`, and when
 * the whole flight fits inside the integrator's first step there is no other
 * sign change for the detector to find — so it localizes the launch instant and
 * returns `ok: true`, `timeOfFlight: 0`, `impact:` the launch point. That is a
 * range of zero, reported as though it were real. Differencing across the edge
 * of that region produced a slope of `4.5e5 m/rad` in testing, against a
 * drag-free maximum of `2v₀²/g ≈ 734` — a number that is nonsense but finite,
 * positive and plausible-looking, which is exactly the kind this module must
 * not print next to the word "condition number". Filed as `P0.97`; the fix
 * belongs to the event detector, not here, so this rejects the reading instead
 * of repairing it.
 */
function measureSlope(
  residual: ResidualFunction,
  speed: number,
  theta: number,
  step: number,
  downrangeAxis: number,
  launchDownrange: number,
  count: () => void,
): number | null {
  const rangeAt = (at: number): number | null => {
    count();
    const evaluation = residual({ theta: at, speed });
    if (!evaluation.ok || evaluation.impact === null) {
      return null;
    }
    if (evaluation.timeOfFlight === null || evaluation.timeOfFlight <= 0) {
      return null;
    }
    return evaluation.impact[downrangeAxis]! - launchDownrange;
  };

  const plus = rangeAt(theta + step);
  const minus = rangeAt(theta - step);
  if (plus === null || minus === null) {
    return null;
  }
  return (plus - minus) / (2 * step);
}

/** Build the {@link ArcConditioning} for one solved arc. */
function conditioningOf(
  arc: ArcLabel,
  theta: number,
  targetDownrange: number,
  residual: ResidualFunction,
  speed: number,
  step: number,
  downrangeAxis: number,
  launchDownrange: number,
  count: () => void,
): ArcConditioning {
  const slope = measureSlope(residual, speed, theta, step, downrangeAxis, launchDownrange, count);
  const sensitivity = slope === null ? null : slope === 0 ? Infinity : 1 / Math.abs(slope);
  const relativeConditionNumber =
    sensitivity === null || theta === 0
      ? null
      : (sensitivity * Math.abs(targetDownrange)) / Math.abs(theta);

  return {
    arc,
    theta,
    slope,
    sensitivity,
    relativeConditionNumber,
    level: conditioningLevel(relativeConditionNumber, slope),
  };
}

/**
 * Compose the warning line for a level. `null` when well-conditioned.
 *
 * It names the measured number and what it costs in digits, because
 * "ill-conditioned" on its own tells a caller nothing they can act on, and it
 * says the aim is *not wrong* — the answer `solveArcs` returned is still the
 * best one available, and a caller who reads the warning as "the solve failed"
 * would discard a usable aim.
 */
function warningFor(
  level: ConditioningLevel,
  envelopeMargin: number,
  conditionNumber: number | null,
): string | null {
  if (level === "well-conditioned") {
    return null;
  }
  if (envelopeMargin < 0) {
    return (
      `target is ${Math.abs(envelopeMargin).toFixed(3)} m beyond this speed's envelope: no ` +
      "elevation reaches it, and the two arcs have merged and vanished (raise v₀, or accept the miss)"
    );
  }
  const cost =
    conditionNumber === null || !Number.isFinite(conditionNumber)
      ? "the slope ∂R/∂θ could not be measured at all"
      : `κ ≈ ${conditionNumber.toFixed(0)}, so roughly ` +
        `${Math.log10(conditionNumber).toFixed(1)} significant digits of the target's position ` +
        "do not survive into the elevation";
  return (
    `${level === "at-fold" ? "at the fold" : "ill-conditioned"}: the target is ` +
    `${envelopeMargin.toFixed(3)} m short of this speed's envelope, where ∂R/∂θ → 0 — ${cost}. ` +
    "The aim is not wrong, but it is not sharp; κ grows as (margin)^(-1/2), so buying a digit " +
    "back costs a hundredfold more margin."
  );
}

/**
 * {@link solveArcs}, plus the conditioning of what it returned and a warning
 * when that conditioning is poor.
 *
 * **A wrapper rather than a change to `solveArcs`.** The arcs it returns are
 * byte-for-byte the ones `solveArcs` returns; this adds a measurement and a
 * judgement beside them. P5.23 asks the solver to *warn*, not to behave
 * differently — behaving differently near the fold is P5.26's
 * Levenberg–Marquardt fallback, and pre-empting it here would leave that task
 * with nothing to measure against.
 *
 * Costs two extra integrations per solved arc — one central difference — on top
 * of `solveArcs`' own sweep and root solves, which run to dozens. The warning
 * is therefore close to free relative to the answer it annotates.
 *
 * @param problem The shooting problem; its `target` supplies the downrange.
 * @param speed The fixed launch speed, m/s — the parameter that creates the fold.
 */
export function solveArcsWithConditioning(
  problem: ShootingProblem,
  speed: number,
  options: ConditioningOptions = {},
): ConditionedArcPair {
  const step = options.slopeStep ?? DEFAULT_SLOPE_STEP;
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new Error(
      `solveArcsWithConditioning: slopeStep must be finite and positive; got ${step}`,
    );
  }

  const arcs = solveArcs(problem, speed, options);

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const downrangeAxis = downrangeAxisOf(layout);
  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
  const launchDownrange = launchPoint[downrangeAxis]!;
  const residual = createShootingResidual(problem);

  let extra = 0;
  const count = (): void => {
    extra++;
  };

  const low =
    arcs.low === null
      ? null
      : conditioningOf(
          "low",
          arcs.low.aim.theta,
          arcs.targetDownrange,
          residual,
          speed,
          step,
          downrangeAxis,
          launchDownrange,
          count,
        );
  const high =
    arcs.high === null
      ? null
      : conditioningOf(
          "high",
          arcs.high.aim.theta,
          arcs.targetDownrange,
          residual,
          speed,
          step,
          downrangeAxis,
          launchDownrange,
          count,
        );

  // Signed, unlike solveArcs' own `shortfall`: see ConditionedArcPair.envelopeMargin.
  const envelopeMargin = arcs.maxDownrange - arcs.targetDownrange;

  const arcSeparation = low === null || high === null ? null : Math.abs(high.theta - low.theta);

  const level = !arcs.reachable
    ? "at-fold"
    : worseLevel(low?.level ?? "well-conditioned", high?.level ?? "well-conditioned");

  const worstConditionNumber = [low?.relativeConditionNumber, high?.relativeConditionNumber]
    .filter((k): k is number => typeof k === "number")
    .reduce<number | null>((worst, k) => (worst === null || k > worst ? k : worst), null);

  return {
    arcs,
    low,
    high,
    envelopeMargin,
    arcSeparation,
    level,
    warning: warningFor(level, envelopeMargin, worstConditionNumber),
    evaluations: arcs.evaluations + extra,
  };
}

/**
 * The exhibit: conditioning at a series of targets marching towards the
 * envelope.
 *
 * The targets are given as *margins* — metres short of the envelope — rather
 * than as absolute downranges, because the envelope is not known until it is
 * measured and the whole point is to control the distance to it. A geometric
 * series of margins is what turns the `s^{-1/2}` law into a straight line on a
 * log-log plot; {@link geometricMargins} builds one.
 *
 * The envelope is located **once**, by a single preliminary `solveArcs` at a
 * target certain to be reachable, and every row is then placed relative to that
 * one measurement. Locating it per row would let the peak search's own
 * tolerance wander between rows and add scatter to the very quantity being
 * fitted.
 *
 * @param problem Supplies the model, environment, launch point and layout. Its
 *   `target` is overridden per row, so its downrange is irrelevant here.
 * @param speed The fixed launch speed, m/s.
 * @param margins Metres short of the envelope, one per row. Negative values ask
 *   for targets *beyond* it, which is a legitimate row: it is where the arcs
 *   have merged and vanished, and the plot should show that they do.
 */
export function sweepEnvelopeConditioning(
  problem: ShootingProblem,
  speed: number,
  margins: readonly number[],
  options: ConditioningOptions = {},
): ConditioningSweep {
  if (margins.length === 0) {
    throw new Error("sweepEnvelopeConditioning: needs at least one margin");
  }
  for (const margin of margins) {
    if (!Number.isFinite(margin)) {
      throw new Error(`sweepEnvelopeConditioning: every margin must be finite; got ${margin}`);
    }
  }

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const downrangeAxis = downrangeAxisOf(layout);
  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);

  // One preliminary solve locates the envelope. The target it uses is arbitrary
  // and only has to be reachable; `maxDownrange` does not depend on it.
  const probe = solveArcs(problem, speed, options);
  const maxDownrange = probe.maxDownrange;
  let evaluations = probe.evaluations;

  const samples: ConditioningSample[] = [];
  for (const margin of margins) {
    const targetDownrange = maxDownrange - margin;
    const center = [...launchPoint];
    center[downrangeAxis] = launchPoint[downrangeAxis]! + targetDownrange;

    const row = solveArcsWithConditioning(
      { ...problem, target: { kind: "point", center } },
      speed,
      options,
    );
    evaluations += row.evaluations;
    samples.push({ ...row, targetDownrange });
  }

  return { samples, maxDownrange, peakAngle: probe.peakAngle, evaluations };
}

/**
 * `count` margins in geometric progression from `largest` down to `smallest`,
 * inclusive.
 *
 * Geometric rather than linear because the law being exhibited is a power law:
 * equally spaced *ratios* are equally spaced on a log axis, so the fit gets the
 * same leverage from every row. A linear ladder would spend most of its rows
 * far from the fold, where nothing happens.
 */
export function geometricMargins(largest: number, smallest: number, count: number): number[] {
  if (!(largest > 0) || !(smallest > 0)) {
    throw new Error(`geometricMargins: both ends must be positive; got ${largest} and ${smallest}`);
  }
  if (!(largest > smallest)) {
    throw new Error(`geometricMargins: largest ${largest} must exceed smallest ${smallest}`);
  }
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`geometricMargins: count must be an integer >= 2; got ${count}`);
  }
  const ratio = Math.pow(smallest / largest, 1 / (count - 1));
  return Array.from({ length: count }, (_, i) => largest * Math.pow(ratio, i));
}

/**
 * Least-squares slope of `log y` against `log x` — the exponent of a power law
 * `y ∝ x^p`.
 *
 * Pairs with a non-positive or non-finite coordinate are dropped rather than
 * clamped: a log fit has nothing to do with them, and substituting a floor
 * would bend the line towards whatever floor was chosen. Returns `null` if
 * fewer than two usable pairs survive, since one point has no slope.
 */
export function logLogSlope(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) {
    throw new Error(`logLogSlope: ${xs.length} x values but ${ys.length} y values`);
  }
  const points: Array<[number, number]> = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y)) {
      points.push([Math.log(x), Math.log(y)]);
    }
  }
  if (points.length < 2) {
    return null;
  }
  const n = points.length;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let cov = 0;
  let varX = 0;
  for (const [x, y] of points) {
    cov += (x - meanX) * (y - meanY);
    varX += (x - meanX) * (x - meanX);
  }
  return varX === 0 ? null : cov / varX;
}
