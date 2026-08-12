/**
 * State for the live convergence trace (P5.18's "UI shows live convergence
 * trace; cancel works"). Split from the component for the reason every
 * `*-panel-logic.ts` in this package is: the interesting part is a state
 * machine over messages arriving from a worker, and a reducer can be tested
 * against every ordering without rendering anything.
 *
 * P5.19 added the plot of the same data: `traceMeritPoints` derives the
 * `(iteration, ‖F‖)` sequence from these rows, so the curve and the table are
 * two views of one stream and cannot disagree about what the solve did.
 */

import { finalMeritSlopeRatio, type NewtonTracePoint } from "@ballista/analysis";
import type { OptimizeIteration, OptimizeJobResult } from "@ballista/runtime";

/** Where a solve is in its lifecycle. */
export type TraceStatus =
  /** Nothing has been run yet. */
  | "idle"
  /** A solve is in flight; iterations are arriving. */
  | "running"
  /** The solve finished on its own, converged or not — read {@link TraceState.result}. */
  | "settled"
  /** The user cancelled it. Rows already received are kept. */
  | "cancelled"
  /** The job threw rather than returning a result. */
  | "failed";

/** One row of the trace: the fields a reader actually scans, flattened. */
export interface TraceRow {
  readonly iteration: number;
  /** `‖F‖` at the start of this iteration. */
  readonly merit: number;
  /** `‖F‖` after it. */
  readonly nextMerit: number;
  /** Accepted line-search fraction; 0 means the step was rejected. */
  readonly alpha: number;
  readonly rank: number;
  readonly theta: number;
  readonly speed: number;
}

export interface TraceState {
  readonly status: TraceStatus;
  readonly rows: readonly TraceRow[];
  readonly result?: OptimizeJobResult;
  readonly error?: string;
}

export const initialTraceState: TraceState = { status: "idle", rows: [] };

/** Flattens one streamed iteration into a row. */
export function toTraceRow(iteration: OptimizeIteration): TraceRow {
  const { step, aim } = iteration;
  return {
    iteration: step.iteration,
    merit: step.merit,
    nextMerit: step.nextMerit,
    alpha: step.alpha,
    rank: step.rank,
    theta: aim.theta,
    speed: aim.speed,
  };
}

export type TraceAction =
  | { readonly type: "start" }
  | { readonly type: "iteration"; readonly iteration: OptimizeIteration }
  | { readonly type: "settled"; readonly result: OptimizeJobResult }
  | { readonly type: "cancelled" }
  | { readonly type: "failed"; readonly error: string };

/**
 * The trace state machine.
 *
 * **Two orderings drive its shape, and both really happen.** A cancel is
 * raced against the messages already queued from the worker, so an
 * `iteration` can arrive after `cancelled`; it is dropped, because a trace
 * that keeps growing after the user stopped it is a lie about what is
 * running. And a `settled` can arrive after `cancelled` if the solve
 * finished in the window between the click and the termination; the cancel
 * still wins, because the user's action is the thing being reported.
 */
export function traceReducer(state: TraceState, action: TraceAction): TraceState {
  switch (action.type) {
    case "start":
      // A fresh run clears the previous one's rows: two solves interleaved in
      // one table would read as one solve that got worse.
      return { status: "running", rows: [] };
    case "iteration":
      if (state.status !== "running") return state;
      return { ...state, rows: [...state.rows, toTraceRow(action.iteration)] };
    case "settled":
      if (state.status !== "running") return state;
      return { ...state, status: "settled", result: action.result };
    case "cancelled":
      if (state.status !== "running") return state;
      return { ...state, status: "cancelled" };
    case "failed":
      if (state.status !== "running") return state;
      return { ...state, status: "failed", error: action.error };
  }
}

/** True while a solve is in flight — i.e. while Cancel means something. */
export function isRunning(state: TraceState): boolean {
  return state.status === "running";
}

/**
 * `‖F‖` for display. Exponential notation across the board rather than
 * fixed: a converging Newton trace spans metres to `1e-12` in a handful of
 * rows, and a fixed format renders the entire interesting tail as `0.000`.
 */
export function formatMerit(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toExponential(3);
}

/**
 * The `(iteration, ‖F‖)` sequence the P5.19 plot draws, derived from the rows
 * already streamed rather than re-run.
 *
 * **The alignment is the only subtle part.** A row describes a *step*: its
 * `merit` is `‖F‖` at the iterate the step began from and its `nextMerit` is
 * `‖F‖` at the iterate it produced. So row `k` contributes a point at `k + 1`,
 * not at `k`, and the sequence needs one extra point at the front for the
 * initial aim — which is the first row's `merit`. Plotting `merit` at `k`
 * instead would shift the whole curve one iteration left and make the solve
 * look like it converged a step sooner than it did.
 *
 * Consecutive rows agree on the shared residual (row `k`'s `nextMerit` is row
 * `k+1`'s `merit`), so taking `nextMerit` from every row and `merit` from only
 * the first counts each residual exactly once.
 */
export function traceMeritPoints(rows: readonly TraceRow[]): readonly NewtonTracePoint[] {
  const first = rows[0];
  if (first === undefined) return [];
  return [
    { iteration: first.iteration, merit: first.merit },
    ...rows.map((row) => ({ iteration: row.iteration + 1, merit: row.nextMerit })),
  ];
}

/**
 * The observed slope ratio to display beside the plot — ≈ 2 while Newton is in
 * its quadratic regime. `undefined` until three residuals exist, which a
 * caller must render as "no measurement yet" rather than as a number.
 */
export function traceSlopeRatio(rows: readonly TraceRow[]): number | undefined {
  return finalMeritSlopeRatio(traceMeritPoints(rows));
}

/**
 * The ratio as a sentence, for the readout under the plot.
 *
 * It deliberately does not say "quadratic" or "not quadratic". The ratio is a
 * measurement over three residuals, and near the integrator's accuracy floor a
 * perfectly healthy solve reports well under 2 (see
 * `newton-convergence-order.ts`); a component is the wrong place to turn that
 * into a verdict.
 */
export function formatSlopeRatio(ratio: number | undefined): string {
  if (ratio === undefined) return "slope ratio: needs 3 residuals";
  return `slope ratio (last 3): ${ratio.toFixed(2)} — 2.00 is quadratic`;
}

/** A one-line summary of where the solve ended, for a status line. */
export function summarize(state: TraceState): string {
  switch (state.status) {
    case "idle":
      return "Not run yet.";
    case "running":
      return state.rows.length === 0 ? "Solving…" : `Solving… ${state.rows.length} iterations`;
    case "cancelled":
      return `Cancelled after ${state.rows.length} iterations.`;
    case "failed":
      return `Failed: ${state.error ?? "unknown error"}`;
    case "settled": {
      const result = state.result;
      if (result === undefined) return "Finished.";
      const head = result.converged
        ? `Converged in ${result.iterations} iterations`
        : `Stopped (${result.status}) after ${result.iterations} iterations`;
      return `${head}, ‖F‖ = ${formatMerit(result.merit)} m.`;
    }
  }
}
