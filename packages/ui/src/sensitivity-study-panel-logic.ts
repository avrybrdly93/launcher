/**
 * State and geometry for P6.20's sensitivity pane: the tornado from P6.18 and
 * the Sobol' decomposition from P6.19, drawn side by side over one scenario,
 * with a control for `N`.
 *
 * Split from the component for the reason every `*-panel-logic.ts` in this
 * package is: the interesting part is a state machine over messages arriving
 * from a study, plus the arithmetic that turns two very different results into
 * comparable bar widths, and both are worth testing without rendering
 * anything.
 *
 * **The two charts answer different questions and the pane must not blur
 * them.** A tornado bar is a length in metres — how far the range moves when
 * one input is pushed ±σ, everything else held. A Sobol' bar is a *share of
 * variance* — dimensionless, and it accounts for what an input does in
 * combination with the others, which a tornado structurally cannot see. They
 * are normalised separately here for exactly that reason: a single shared
 * scale would invite reading one against the other, and the two quantities do
 * not compare.
 */

import type { SobolIndices, Tornado } from "@ballista/analysis";
import type { SensitivityStudyProgress, SensitivityStudyResult } from "@ballista/runtime";

/** Where a study is in its lifecycle. */
export type SensitivityStudyStatus =
  /** Nothing has been run yet. */
  | "idle"
  /** A study is in flight; progress is arriving. */
  | "running"
  /** A study finished and both results are on screen. */
  | "ready"
  /** The user cancelled it. Any previous result is kept — see {@link sensitivityStudyReducer}. */
  | "cancelled"
  /** The study threw rather than returning results. */
  | "failed";

export interface SensitivityStudyPanelState {
  readonly status: SensitivityStudyStatus;
  /** The most recent progress report of the run in flight. Absent between runs. */
  readonly progress?: SensitivityStudyProgress;
  /** The last completed study. Survives a later cancel or failure. */
  readonly result?: SensitivityStudyResult;
  /** `N` the displayed result was computed at, so the caption cannot drift from the control. */
  readonly resultBaseSamples?: number;
  readonly error?: string;
}

export const initialSensitivityStudyState: SensitivityStudyPanelState = { status: "idle" };

export type SensitivityStudyAction =
  | { readonly type: "start" }
  | { readonly type: "progress"; readonly progress: SensitivityStudyProgress }
  | {
      readonly type: "ready";
      readonly result: SensitivityStudyResult;
      readonly baseSamples: number;
    }
  | { readonly type: "cancelled" }
  | { readonly type: "failed"; readonly error: string };

/**
 * The study state machine.
 *
 * **A cancelled or failed study keeps the results already on screen**, the same
 * choice `basinReducer` makes and for the same reason: a completed study is a
 * true decomposition of the run it was computed on, and blanking it because a
 * *later*, longer run was abandoned would throw away the only correct thing on
 * screen. `status` and {@link summarizeStudy} say which case the reader is
 * looking at, and {@link SensitivityStudyPanelState.resultBaseSamples} says
 * what `N` the surviving result belongs to — without it, a reader who moved the
 * `N` control and then cancelled would read the old result under the new
 * label.
 *
 * **A progress report arriving after a cancel is dropped**, as in
 * `traceReducer`: the study is synchronous but the cancel is raced against
 * whatever the host has already queued, and a bar that keeps filling after the
 * user stopped it is a lie about what is running.
 */
export function sensitivityStudyReducer(
  state: SensitivityStudyPanelState,
  action: SensitivityStudyAction,
): SensitivityStudyPanelState {
  switch (action.type) {
    case "start": {
      // Rebuilt rather than spread so a previous run's `error` and `progress`
      // are *absent*, not present-and-undefined — `exactOptionalPropertyTypes`
      // is on and the two are different types here.
      if (state.result === undefined) return { status: "running" };
      return {
        status: "running",
        result: state.result,
        ...(state.resultBaseSamples === undefined
          ? {}
          : { resultBaseSamples: state.resultBaseSamples }),
      };
    }
    case "progress":
      if (state.status !== "running") return state;
      return { ...state, progress: action.progress };
    case "ready": {
      if (state.status !== "running") return state;
      return {
        status: "ready",
        result: action.result,
        resultBaseSamples: action.baseSamples,
      };
    }
    case "cancelled":
      if (state.status !== "running") return state;
      return { ...state, status: "cancelled" };
    case "failed":
      if (state.status !== "running") return state;
      return { ...state, status: "failed", error: action.error };
  }
}

/** True while a study is in flight — i.e. while Cancel means something. */
export function isStudying(state: SensitivityStudyPanelState): boolean {
  return state.status === "running";
}

/**
 * The `N` values the control offers.
 *
 * Powers of two because the Sobol' sequence's equidistribution guarantees are
 * stated for `2^m` points: stopping a scrambled Sobol' sample partway through a
 * power-of-two block gives up the very uniformity the sequence is chosen for,
 * so an arbitrary `N` is a worse sample than the next power of two down.
 */
export const SOBOL_SAMPLE_CHOICES: readonly number[] = [256, 512, 1024, 2048, 4096, 8192];

/**
 * Snaps an arbitrary `N` onto the offered choices, clamping at both ends.
 *
 * Rounds *down* to the nearest offered value rather than to the nearest,
 * because the cost is `N(d+2)` and a control that silently doubled a person's
 * requested work would be the more surprising of the two errors.
 */
export function clampBaseSamples(requested: number): number {
  const first = SOBOL_SAMPLE_CHOICES[0]!;
  const last = SOBOL_SAMPLE_CHOICES[SOBOL_SAMPLE_CHOICES.length - 1]!;
  if (!Number.isFinite(requested)) return first;
  if (requested <= first) return first;
  if (requested >= last) return last;
  let chosen = first;
  for (const choice of SOBOL_SAMPLE_CHOICES) {
    if (choice <= requested) chosen = choice;
  }
  return chosen;
}

/** One tornado bar, reduced to what a renderer needs. */
export interface TornadoBarGeometry {
  readonly input: string;
  /** Bar length as a fraction of the widest bar, in `[0, 1]`. Zero when censored. */
  readonly fraction: number;
  /** `|high − low|` in output units, or `undefined` when censored. */
  readonly span: number | undefined;
  /** Whether either endpoint had no answer, so the bar is not a length. */
  readonly censored: boolean;
  /**
   * Whether the response is monotone across the bar. A non-monotone bar sits at
   * a local extremum, where the bar's *centre* rather than its width is the
   * interesting quantity — a case the chart renders identically to a monotone
   * bar and so must flag in text.
   */
  readonly monotone: boolean;
}

/**
 * Tornado bars as fractions of the widest, in the order the tornado already
 * sorted them.
 *
 * **Censored bars get zero width and are flagged, not dropped.** A censored bar
 * means the model had no answer at one of the input's endpoints, which is a
 * finding about the scenario; omitting the row would present a shorter ranking
 * as though it were complete.
 */
export function tornadoBarGeometry(tornado: Tornado): readonly TornadoBarGeometry[] {
  let widest = 0;
  for (const bar of tornado.bars) {
    if (bar.span !== null && bar.span > widest) widest = bar.span;
  }
  return tornado.bars.map((bar) => ({
    input: bar.input,
    // A degenerate tornado — every bar zero-width, e.g. every σ zero — divides
    // by zero otherwise, and `0/0` would render as a NaN-width bar.
    fraction: bar.span === null || widest === 0 ? 0 : bar.span / widest,
    span: bar.span === null ? undefined : bar.span,
    censored: bar.censored,
    monotone: bar.monotone,
  }));
}

/** One input's pair of Sobol' bars. */
export interface SobolBarGeometry {
  readonly input: string;
  /** `S_k`, reported unclamped — a negative value is the signal that `N` is too small. */
  readonly first: number;
  /** `S_T_k`. */
  readonly total: number;
  /** `S_k` bar width in `[0, 1]`, clamped — see {@link sobolBarGeometry}. */
  readonly firstWidth: number;
  /** `S_T_k` bar width in `[0, 1]`, clamped. */
  readonly totalWidth: number;
  /** i.i.d. standard error of `S_k`. */
  readonly firstStandardError: number;
  /**
   * Whether `S_k` is within two of its own standard errors of zero — i.e.
   * whether this sample can tell the index from nothing at all.
   */
  readonly indistinguishableFromZero: boolean;
}

/**
 * Sobol' bars, on the fixed `[0, 1]` variance-share scale.
 *
 * **The scale is fixed rather than normalised to the largest index, unlike the
 * tornado's.** A variance share already has an absolute meaning: 0.4 is 40% of
 * the output variance whatever the other inputs do. Rescaling so the biggest
 * bar fills the width would make a decomposition where nothing dominates look
 * identical to one where something does.
 *
 * **Widths are clamped to `[0, 1]` but the reported numbers are not.** `S_k` is
 * an unclamped estimate and a small negative value is meaningful — it says the
 * sample cannot resolve the index — so the number keeps its sign for the label
 * while the bar, which cannot be drawn with negative width, goes to zero.
 * {@link SobolBarGeometry.indistinguishableFromZero} is what a renderer should
 * use to say so in words.
 */
export function sobolBarGeometry(sobol: SobolIndices): readonly SobolBarGeometry[] {
  return sobol.indices.map((index) => ({
    input: index.input,
    first: index.first,
    total: index.total,
    firstWidth: Math.min(1, Math.max(0, index.first)),
    totalWidth: Math.min(1, Math.max(0, index.total)),
    firstStandardError: index.firstStandardError,
    indistinguishableFromZero: Math.abs(index.first) <= 2 * index.firstStandardError,
  }));
}

/** Fraction complete in `[0, 1]`, or `undefined` when nothing is running. */
export function progressFraction(state: SensitivityStudyPanelState): number | undefined {
  const progress = state.progress;
  if (progress === undefined || progress.total === 0) return undefined;
  return Math.min(1, Math.max(0, progress.completed / progress.total));
}

/** The progress line under the bar, naming the stage as well as the count. */
export function formatProgress(state: SensitivityStudyPanelState): string {
  const progress = state.progress;
  if (progress === undefined) return "";
  const percent = ((progress.completed / progress.total) * 100).toFixed(0);
  const stage = progress.stage === "tornado" ? "tornado" : "Sobol'";
  return `${stage}: ${progress.completed} / ${progress.total} evaluations (${percent}%)`;
}

/**
 * The interaction-share readout — P6.19's headline result, and the one number
 * on this pane that the tornado beside it cannot produce at any sample size.
 */
export function formatInteractionShare(sobol: SobolIndices): string {
  const percent = (sobol.interactionShare * 100).toFixed(1);
  return (
    `${percent}% of output variance is in interactions ` +
    `(1 − Σ Sₖ) — the share no tornado can attribute`
  );
}

/** A one-line summary of where the study ended, for a status line. */
export function summarizeStudy(state: SensitivityStudyPanelState): string {
  switch (state.status) {
    case "idle":
      return "Not run yet.";
    case "running":
      return state.progress === undefined ? "Starting…" : formatProgress(state);
    case "failed":
      return `Failed: ${state.error ?? "unknown error"}`;
    case "cancelled":
      return state.result === undefined
        ? "Cancelled before any result was produced."
        : `Cancelled. Showing the previous study (N = ${state.resultBaseSamples ?? "?"}).`;
    case "ready": {
      const result = state.result;
      if (result === undefined) return "Finished.";
      const censored = result.sobol.censored
        ? " Some evaluations had no answer, so the indices are conditional."
        : "";
      return (
        `${result.evaluations} evaluations at N = ${state.resultBaseSamples ?? "?"}.` + censored
      );
    }
  }
}
