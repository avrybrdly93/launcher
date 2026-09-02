/**
 * State and geometry for P6.24's Monte Carlo dashboard: one uncertainty study,
 * four views of it — the range histogram (P6.09), the trajectory fan (P6.10),
 * the hit probability (P6.11) and the estimate with its interval (P6.08).
 *
 * Split from the component for the reason every `*-page-logic.ts` here is: the
 * interesting part is a state machine over messages arriving from a study, plus
 * the arithmetic that turns typed arrays into bar widths and polyline points,
 * and both are worth testing without rendering anything.
 *
 * **The histogram is built here rather than in `runtime`, and that is a
 * dependency fact, not a preference.** `buildImpactHistogram` lives in
 * `@ballista/viz`, which already depends on `@ballista/runtime`; a histogram
 * built inside `mc-dashboard-study.ts` would close the cycle. The study
 * therefore hands back the raw `range` column and the `landed` mask, and this
 * module — one layer further out, where `viz` is reachable — bins it.
 *
 * **Every number this module produces carries its `n`.** `formatRangeEstimate`
 * refuses to render an interval without the sample size, because
 * `formatMeanConfidenceInterval` refuses to, and `formatHitProbability` does
 * the same for the Wilson interval. That is P6.08's "displayed honestly with
 * N" enforced at the only layer where it could be lost.
 */

import {
  formatHitProbability,
  formatMeanConfidenceInterval,
  meanConfidenceInterval,
  type EnsembleFan,
} from "@ballista/analysis";
import type { McDashboardProgress, McDashboardResult } from "@ballista/runtime";
import { buildImpactHistogram, type ImpactHistogram } from "@ballista/viz";

/** Where a study is in its lifecycle. Mirrors `sensitivity-study-panel-logic.ts`. */
export type McStudyStatus = "idle" | "running" | "ready" | "cancelled" | "failed";

export interface McPageState {
  readonly status: McStudyStatus;
  /** The most recent progress report of the run in flight. Absent between runs. */
  readonly progress?: McDashboardProgress;
  /** The last completed study. Survives a later cancel or failure. */
  readonly result?: McDashboardResult;
  /** `N` the displayed result was computed at, so the caption cannot drift from the control. */
  readonly resultReplicates?: number;
  readonly error?: string;
}

export const initialMcPageState: McPageState = { status: "idle" };

export type McPageAction =
  | { readonly type: "start" }
  | { readonly type: "progress"; readonly progress: McDashboardProgress }
  | { readonly type: "ready"; readonly result: McDashboardResult; readonly replicates: number }
  | { readonly type: "cancelled" }
  | { readonly type: "failed"; readonly error: string };

/**
 * The dashboard state machine.
 *
 * **A cancelled or failed study keeps the results already on screen**, the
 * choice `sensitivityStudyReducer` and `basinReducer` both make: a completed
 * study is a true description of the ensemble it was computed on, and blanking
 * it because a *later*, longer run was abandoned throws away the only correct
 * thing on screen. `status` and {@link summarizeMcStudy} say which case the
 * reader is looking at, and {@link McPageState.resultReplicates} says what `N`
 * the surviving result belongs to — without it a reader who moved the `N`
 * control and then cancelled would read the old result under the new label.
 *
 * **A progress report arriving after a cancel is dropped.** The study is
 * synchronous but the cancel is raced against whatever the host has already
 * queued, and a bar that keeps filling after the user stopped it is a lie about
 * what is running.
 */
export function mcPageReducer(state: McPageState, action: McPageAction): McPageState {
  switch (action.type) {
    case "start": {
      // Rebuilt rather than spread so a previous run's `error` and `progress`
      // are *absent*, not present-and-undefined — `exactOptionalPropertyTypes`
      // is on and the two are different types here.
      if (state.result === undefined) return { status: "running" };
      return {
        status: "running",
        result: state.result,
        ...(state.resultReplicates === undefined
          ? {}
          : { resultReplicates: state.resultReplicates }),
      };
    }
    case "progress":
      if (state.status !== "running") return state;
      return { ...state, progress: action.progress };
    case "ready":
      if (state.status !== "running") return state;
      return { status: "ready", result: action.result, resultReplicates: action.replicates };
    case "cancelled":
      if (state.status !== "running") return state;
      return { ...state, status: "cancelled" };
    case "failed":
      if (state.status !== "running") return state;
      return { ...state, status: "failed", error: action.error };
  }
}

/** True while a study is in flight — i.e. while Cancel means something. */
export function isMcStudyRunning(state: McPageState): boolean {
  return state.status === "running";
}

/**
 * Fraction of the run completed, or `undefined` before the first report.
 *
 * `undefined` rather than `0` so the component can render an *indeterminate*
 * progress bar until a real count arrives: a determinate bar sitting at zero
 * and one that has not started look identical and mean different things.
 */
export function mcProgressFraction(state: McPageState): number | undefined {
  const progress = state.progress;
  if (state.status !== "running" || progress === undefined || progress.total === 0) {
    return undefined;
  }
  return progress.completed / progress.total;
}

/** One line of status text, naming the stage while a study is in flight. */
export function summarizeMcStudy(state: McPageState): string {
  switch (state.status) {
    case "idle":
      return "No study run yet.";
    case "running": {
      const progress = state.progress;
      if (progress === undefined) return "Starting…";
      const stage = progress.stage === "ensemble" ? "sampling" : "recording trajectories";
      return `${stage}: ${progress.completed} / ${progress.total} replicates`;
    }
    case "ready":
      return `Study complete at N = ${state.resultReplicates ?? "?"}.`;
    case "cancelled":
      return state.result === undefined
        ? "Cancelled before any result."
        : `Cancelled. Showing the previous study at N = ${state.resultReplicates ?? "?"}.`;
    case "failed":
      return `Study failed: ${state.error ?? "unknown error"}`;
  }
}

/** The `N` values the control offers. */
export const MC_REPLICATE_CHOICES: readonly number[] = [128, 256, 512, 1024, 2048];

/**
 * Snaps an arbitrary `N` onto the offered choices, clamping at both ends.
 *
 * Rounds *down* like `clampBaseSamples`, and for the same reason: the cost is
 * linear in `N` and a control that silently doubled a person's requested work
 * is the more surprising of the two errors.
 */
export function clampMcReplicates(requested: number): number {
  const first = MC_REPLICATE_CHOICES[0]!;
  const last = MC_REPLICATE_CHOICES[MC_REPLICATE_CHOICES.length - 1]!;
  if (!Number.isFinite(requested)) return first;
  if (requested <= first) return first;
  if (requested >= last) return last;
  let chosen = first;
  for (const choice of MC_REPLICATE_CHOICES) {
    if (choice <= requested) chosen = choice;
  }
  return chosen;
}

/** Bins the landed range column of a completed study. */
export function rangeHistogram(result: McDashboardResult, binCount = 24): ImpactHistogram {
  return buildImpactHistogram(result.columns.range, {
    binCount,
    // P6.09's mask is exactly this column: a replicate that ran out of horizon
    // has a `range` entry — wherever it happened to be at the horizon — and
    // binning it would put a bar under a flight that never landed.
    mask: result.columns.landed,
  });
}

/** One histogram bar, reduced to what a renderer needs. */
export interface HistogramBarGeometry {
  /** Bin index, so a renderer has a stable key. */
  readonly index: number;
  /** Bin's lower edge. */
  readonly from: number;
  /** Bin's upper edge. */
  readonly to: number;
  readonly count: number;
  /** Height as a fraction of the tallest bar, in `[0, 1]`. */
  readonly fraction: number;
}

/**
 * Histogram bars as fractions of the tallest.
 *
 * **An all-empty histogram gives every bar zero height rather than `NaN`.**
 * `count / 0` would render as a NaN-width element, which browsers treat as
 * zero anyway but which shows up in a snapshot as garbage rather than as the
 * honest "nothing to show".
 */
export function histogramBarGeometry(histogram: ImpactHistogram): readonly HistogramBarGeometry[] {
  let tallest = 0;
  for (const count of histogram.counts) {
    if (count > tallest) tallest = count;
  }
  return Array.from(histogram.counts, (count, index) => ({
    index,
    from: histogram.binEdges[index] as number,
    to: histogram.binEdges[index + 1] as number,
    count,
    fraction: tallest === 0 ? 0 : count / tallest,
  }));
}

/** One fan band as a polyline in a unit box, plus what it is a band of. */
export interface FanBandGeometry {
  /** The quantile level, e.g. `0.05`. */
  readonly level: number;
  /**
   * `"x,y "`-joined points in a `[0, 1] x [0, 1]` box with **y already
   * flipped** for SVG's downward axis, so a renderer scales rather than
   * reflects. Empty when the band is `NaN` everywhere.
   */
  readonly points: string;
}

/** The fan reduced to polylines a renderer can scale into any viewport. */
export interface FanGeometry {
  readonly bands: readonly FanBandGeometry[];
  /** Grid span, so an axis can be labelled in seconds. */
  readonly tMin: number;
  readonly tMax: number;
  /** Value span across every finite band sample, so an axis can be labelled in metres. */
  readonly yMin: number;
  readonly yMax: number;
  /**
   * Where {@link EnsembleFan.commonSupportEnd} falls in the unit box, or
   * `undefined` when no grid point has every replicate.
   *
   * Past it the bands are conditional on survival and mean something
   * different. A chart that shades beyond it without saying so is lying by
   * omission, which is `ensemble-fan.ts`'s own phrasing and the reason this
   * is computed here rather than left to the renderer to remember.
   */
  readonly commonSupportX: number | undefined;
}

/**
 * Projects a fan into a unit box.
 *
 * `NaN` samples break the polyline rather than being interpolated across: past
 * a replicate's own flight there is no value, and joining the last real point
 * to the next one would draw a chord through empty air. A band is emitted as
 * its longest run of finite samples' points, with the gaps simply absent —
 * SVG's `polyline` has no notion of a break, so a renderer that needs several
 * segments per band is not what P6.24 asks for; what it asks for is that the
 * drawn part be true.
 */
export function fanGeometry(fan: EnsembleFan): FanGeometry {
  const grid = fan.grid;
  const tMin = grid[0] as number;
  const tMax = grid[grid.length - 1] as number;
  const tSpan = tMax - tMin;

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const band of fan.bands) {
    for (const value of band) {
      if (!Number.isFinite(value)) continue;
      if (value < yMin) yMin = value;
      if (value > yMax) yMax = value;
    }
  }
  const ySpan = yMax - yMin;

  const projectX = (t: number): number => (tSpan === 0 ? 0 : (t - tMin) / tSpan);
  // Flipped: SVG's y grows downward, so the tallest sample must map to 0.
  const projectY = (y: number): number => (ySpan === 0 ? 0.5 : (yMax - y) / ySpan);

  const bands = fan.bands.map((band, k) => {
    const points: string[] = [];
    for (let g = 0; g < band.length; g += 1) {
      const value = band[g] as number;
      if (!Number.isFinite(value)) continue;
      points.push(`${projectX(grid[g] as number).toFixed(6)},${projectY(value).toFixed(6)}`);
    }
    return { level: fan.levels[k] as number, points: points.join(" ") };
  });

  return {
    bands,
    tMin,
    tMax,
    yMin: Number.isFinite(yMin) ? yMin : 0,
    yMax: Number.isFinite(yMax) ? yMax : 0,
    commonSupportX: Number.isFinite(fan.commonSupportEnd)
      ? projectX(fan.commonSupportEnd)
      : undefined,
  };
}

/**
 * The range estimate with its `t` interval, or an honest refusal.
 *
 * Returns a sentence rather than `null` for a sample too small to have an
 * interval, because the alternative — a blank where a number belongs — reads
 * as a rendering bug rather than as "one replicate carries no information
 * about spread".
 */
export function formatRangeEstimate(result: McDashboardResult, level = 0.95): string {
  const landed: number[] = [];
  for (let i = 0; i < result.columns.range.length; i += 1) {
    if (result.columns.landed[i] === 1) landed.push(result.columns.range[i] as number);
  }
  const ci = meanConfidenceInterval(landed, level);
  if (ci === null) {
    return `${landed.length} landed replicate(s) — too few for an interval`;
  }
  return formatMeanConfidenceInterval(ci, { digits: 2, unit: "m" });
}

/**
 * The scored part of a study — the completed result or a P6.25 partial.
 *
 * Both carry the same two fields for the same reason, so both format the same
 * way. Taking the narrower shape rather than `McDashboardResult` is what stops
 * the live estimate and the final one from being two formatters that could
 * disagree about how to say the same thing.
 */
export interface McScoredEstimate {
  readonly hit: McDashboardResult["hit"];
  readonly unlandedCount: number;
}

/** The hit probability with its Wilson interval and `n`, plus the conditioning. */
export function formatHitEstimate(result: McScoredEstimate): string {
  const base = formatHitProbability(result.hit);
  if (result.unlandedCount === 0) return base;
  // Never silently: at unlandedCount > 0 the denominator is the landed subset,
  // so the number on screen answers "given it landed" and the reader has to be
  // told which question was asked.
  return `${base} — conditional on landing; ${result.unlandedCount} replicate(s) did not land`;
}

/**
 * The live hit-probability estimate while a study runs, or `undefined` (P6.25).
 *
 * `undefined` in three distinct situations, all of which mean "there is no
 * live estimate to show" and none of which should be rendered as a number:
 * no study is running; a study is running but has not reached its first
 * partial; or it has, but nothing has landed yet, so the ensemble cannot be
 * scored at all. The component renders nothing in every case rather than a
 * placeholder interval, because a zero-width band at `p̂ = 0` is a claim, and
 * "we have not found out yet" is not that claim.
 *
 * Formatted by {@link formatHitEstimate}, the same function the finished study
 * uses, so the live number and the final one cannot drift apart in how they
 * present themselves — only in what they are computed from.
 */
export function formatLiveHitEstimate(state: McPageState): string | undefined {
  if (state.status !== "running") return undefined;
  const partial = state.progress?.partial;
  if (partial === undefined) return undefined;
  return formatHitEstimate(partial);
}

/**
 * How many replicates the live estimate is drawn from, or `undefined`.
 *
 * Reported beside the estimate rather than folded into it: an interval that
 * narrows is only meaningful if a reader can see the `n` it narrowed against.
 */
export function liveEstimateSampleSize(state: McPageState): number | undefined {
  if (state.status !== "running") return undefined;
  return state.progress?.partial?.sampled;
}
