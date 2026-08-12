/**
 * Live convergence trace for a Newton shooting solve (P5.18): runs an
 * optimize job through the worker pool and fills a table row by row as the
 * iterations stream in, with a Cancel button that stops it. P5.19 added the
 * `log‖F‖` vs iteration plot above the table, drawn from the same rows, so
 * the picture and the numbers are one stream rendered twice rather than two
 * measurements that could drift apart.
 *
 * **`runOptimize` is a prop rather than a pool this component builds.** The
 * component's job is the live-update and cancel behaviour, and injecting the
 * runner lets a test drive both deterministically — releasing iterations one
 * at a time, cancelling between two of them — without a real Worker, while
 * the app edge passes `pool.runOptimize` straight through. It is the same
 * injection `worker-pool.ts` itself uses for `WorkerFactory`, one layer up.
 */

import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import type { OptimizeJob, OptimizeJobResult } from "@ballista/runtime";
import { buildNewtonTraceFigure } from "@ballista/viz";
import {
  formatMerit,
  formatSlopeRatio,
  initialTraceState,
  isRunning,
  summarize,
  traceMeritPoints,
  traceReducer,
  traceSlopeRatio,
} from "./convergence-trace-panel-logic.js";
import { LazyPlotlyView } from "./lazy-plotly-view.js";
import type { OptimizeIteration } from "@ballista/runtime";

/** The subset of `WorkerPool["runOptimize"]` this panel calls. */
export type OptimizeRunner = (
  job: OptimizeJob,
  options: {
    readonly onIteration?: (iteration: OptimizeIteration) => void;
    readonly signal?: AbortSignal;
  },
) => Promise<OptimizeJobResult>;

export interface ConvergenceTracePanelProps {
  readonly job: OptimizeJob;
  readonly runOptimize: OptimizeRunner;
}

export function ConvergenceTracePanel({ job, runOptimize }: ConvergenceTracePanelProps) {
  const [state, dispatch] = useReducer(traceReducer, initialTraceState);
  const controllerRef = useRef<AbortController | null>(null);

  // A solve outlives the component if the user navigates away mid-run, and
  // its worker keeps integrating trajectories nobody will read. Aborting on
  // unmount terminates it, which is the same cancel path the button uses.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const solve = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start" });
    try {
      const result = await runOptimize(job, {
        signal: controller.signal,
        onIteration: (iteration) => dispatch({ type: "iteration", iteration }),
      });
      dispatch({ type: "settled", result });
    } catch (error) {
      // An abort is the user's own doing, not a failure to report as one.
      if (controller.signal.aborted) dispatch({ type: "cancelled" });
      else
        dispatch({ type: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [job, runOptimize]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const running = isRunning(state);
  // Recomputed per render rather than memoized: the sequence is one pass over
  // ~20 rows, and `LazyPlotlyView` re-renders on spec identity anyway, so a
  // `useMemo` here would buy nothing and add a dependency array to keep right.
  const points = traceMeritPoints(state.rows);

  return (
    <div class="convergence-trace-panel" data-testid="convergence-trace-panel">
      <div class="convergence-trace-controls">
        <button
          type="button"
          data-testid="convergence-trace-solve"
          onClick={() => void solve()}
          disabled={running}
        >
          Solve
        </button>
        <button
          type="button"
          data-testid="convergence-trace-cancel"
          onClick={cancel}
          disabled={!running}
        >
          Cancel
        </button>
      </div>

      <p
        class="convergence-trace-status"
        data-testid="convergence-trace-status"
        data-status={state.status}
      >
        {summarize(state)}
      </p>

      {/*
        Two points is the minimum a line can be drawn through, and until then
        the pane would be an empty axis box that reads as a broken plot. The
        table below carries the single-row case on its own.
      */}
      {points.length >= 2 && (
        <div class="convergence-trace-plot" data-testid="convergence-trace-plot">
          <LazyPlotlyView spec={buildNewtonTraceFigure([{ label: "‖F‖", points }])} />
          <p class="convergence-trace-slope-ratio" data-testid="convergence-trace-slope-ratio">
            {formatSlopeRatio(traceSlopeRatio(state.rows))}
          </p>
        </div>
      )}

      <table class="convergence-trace-table" data-testid="convergence-trace-table">
        <caption>Newton iterations, newest last</caption>
        <thead>
          <tr>
            <th scope="col">k</th>
            <th scope="col">‖F‖ (m)</th>
            <th scope="col">α</th>
            <th scope="col">rank</th>
            <th scope="col">θ (rad)</th>
            <th scope="col">v₀ (m/s)</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <tr key={row.iteration} data-testid={`convergence-trace-row-${row.iteration}`}>
              <td>{row.iteration}</td>
              <td>{formatMerit(row.nextMerit)}</td>
              <td>{row.alpha.toFixed(4)}</td>
              <td>{row.rank}</td>
              <td>{row.theta.toFixed(6)}</td>
              <td>{row.speed.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
