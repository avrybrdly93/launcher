/**
 * Basin-of-attraction map for the Newton shooting solve (P5.20): sweeps a grid
 * of initial guesses and paints each cell by the arc the solver converged to
 * from there, with a legend and the boundary measurement underneath.
 *
 * **What the picture answers.** P5.08 says a reachable target has two aims;
 * this says which one you get, as a function of where you start. The axes are
 * therefore the *initial guess*, not the solution.
 *
 * **`runSweep` is a prop rather than something this component builds**, the
 * same injection `ConvergenceTracePanel` uses for `runOptimize` and for the
 * same two reasons: a test can drive the lifecycle deterministically without a
 * real Worker, and a sweep is `n²` Newton solves that have no business running
 * on the UI thread when the app wires this up for real.
 */

import { buildBasinFigure } from "@ballista/viz";
import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import type { BasinGrid } from "@ballista/analysis";
import {
  basinReducer,
  censusFor,
  formatBoundary,
  initialBasinState,
  isSweeping,
  summarizeSweep,
} from "./basin-panel-logic.js";
import { LazyPlotlyView } from "./lazy-plotly-view.js";

/** Runs one sweep. Rejects with an `AbortError` when `signal` fires. */
export type BasinSweepRunner = (options: { readonly signal?: AbortSignal }) => Promise<BasinGrid>;

export interface BasinPanelProps {
  readonly runSweep: BasinSweepRunner;
}

/** Legend rows, in the class order `buildBasinFigure` paints them. */
const LEGEND = [
  { key: "low", label: "low arc — flat, fast" },
  { key: "high", label: "high arc — lofted" },
  { key: "unconverged", label: "no branch resolved" },
  { key: "failed", label: "no impact — outside the reachable set" },
] as const;

export function BasinPanel({ runSweep }: BasinPanelProps) {
  const [state, dispatch] = useReducer(basinReducer, initialBasinState);
  const controllerRef = useRef<AbortController | null>(null);

  // A sweep outlives the component if the user navigates away mid-run, and its
  // workers keep integrating trajectories nobody will read. Same unmount abort
  // as the convergence-trace panel, and the same path the button uses.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const sweep = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start" });
    try {
      const grid = await runSweep({ signal: controller.signal });
      // A sweep that finished in the window between the click and the abort
      // still belongs to a cancelled run; the reducer drops it because its
      // status is no longer "running".
      dispatch({ type: "ready", grid });
    } catch (error) {
      if (controller.signal.aborted) dispatch({ type: "cancelled" });
      else
        dispatch({ type: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [runSweep]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const sweeping = isSweeping(state);
  const grid = state.grid;
  const census = censusFor(grid);

  return (
    <div class="basin-panel" data-testid="basin-panel">
      <div class="basin-controls">
        <button
          type="button"
          data-testid="basin-sweep"
          onClick={() => void sweep()}
          disabled={sweeping}
        >
          Sweep
        </button>
        <button type="button" data-testid="basin-cancel" onClick={cancel} disabled={!sweeping}>
          Cancel
        </button>
      </div>

      <p class="basin-status" data-testid="basin-status" data-status={state.status}>
        {summarizeSweep(state)}
      </p>

      {grid !== undefined && (
        <div class="basin-map" data-testid="basin-map">
          <LazyPlotlyView spec={buildBasinFigure(grid)} />
          <ul class="basin-legend" data-testid="basin-legend">
            {LEGEND.map((entry) => (
              <li key={entry.key} data-testid={`basin-legend-${entry.key}`} data-swatch={entry.key}>
                {entry.label}
                {census !== undefined ? ` — ${census[entry.key]}` : ""}
              </li>
            ))}
          </ul>
          <p class="basin-boundary" data-testid="basin-boundary">
            {formatBoundary(grid)}
          </p>
        </div>
      )}
    </div>
  );
}
