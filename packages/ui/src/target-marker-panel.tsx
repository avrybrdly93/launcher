/**
 * Draggable target marker (P5.21): drag the marker across the plot, drop it,
 * and the two aims that reach it appear — with a low/high chooser and the
 * drag→solution latency the criterion asks to be measured.
 *
 * **`runSolve` is a prop rather than something this component builds**, the
 * same injection `BasinPanel` uses for `runSweep` and for the same two reasons:
 * a test can drive the lifecycle deterministically without integrating a single
 * trajectory, and a real solve is a pair of Brent root-finds that has no
 * business running on the UI thread when the app wires this up.
 *
 * **The pointer is captured on drag start.** Without capture, a pointer that
 * leaves the plot box mid-drag stops delivering `pointermove` to this element
 * and the marker sticks at the boundary while the user keeps dragging — then
 * jumps when they come back. Capture also guarantees the matching `pointerup`
 * arrives here, which is what issues the solve; losing it would leave the
 * marker stuck in `dragging` forever with no way out.
 */

import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import type { ArcLabel, ArcPair } from "@ballista/analysis";
import {
  formatLatency,
  formatTarget,
  initialTargetState,
  isSolutionCurrent,
  isSolving,
  selectedSolution,
  summarizeTarget,
  targetReducer,
  worldFromPointer,
  type PlotViewport,
  type TargetPoint,
} from "./target-marker-logic.js";

/** Solves both arcs to `target`. Rejects with an `AbortError` when `signal` fires. */
export type TargetSolveRunner = (
  target: TargetPoint,
  options: { readonly signal?: AbortSignal },
) => Promise<ArcPair>;

export interface TargetMarkerPanelProps {
  readonly runSolve: TargetSolveRunner;
  /** The plot box and the world range it shows. */
  readonly viewport: PlotViewport;
  /** Where the marker starts. */
  readonly initialTarget: TargetPoint;
  /**
   * Clock for the latency measurement. Injected so a test can measure a known
   * interval instead of asserting on a real one, which would be flaky by
   * construction. Defaults to `performance.now`.
   */
  readonly now?: () => number;
}

const ARCS: readonly { readonly key: ArcLabel; readonly label: string }[] = [
  { key: "low", label: "low — flat, fast" },
  { key: "high", label: "high — lofted" },
];

export function TargetMarkerPanel({
  runSolve,
  viewport,
  initialTarget,
  now = () => performance.now(),
}: TargetMarkerPanelProps) {
  const [state, dispatch] = useReducer(targetReducer, initialTargetState(initialTarget));
  const controllerRef = useRef<AbortController | null>(null);
  const draggingRef = useRef(false);

  // A solve outlives the component if the user navigates away mid-drop, and its
  // integrations keep running for a plot nobody will read. Same unmount abort
  // as the basin panel.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const solve = useCallback(
    async (target: TargetPoint) => {
      // A drop supersedes any solve still running: its answer is for a point
      // the user has left, and the reducer would discard it anyway.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const startedAt = now();
      try {
        const arcs = await runSolve(target, { signal: controller.signal });
        if (controller.signal.aborted) return;
        dispatch({ type: "solved", arcs, latencyMs: now() - startedAt });
      } catch (error) {
        if (controller.signal.aborted) return;
        dispatch({
          type: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [runSolve, now],
  );

  const pointAt = useCallback(
    (event: PointerEvent): TargetPoint => {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      return worldFromPointer(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        viewport,
      );
    },
    [viewport],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      draggingRef.current = true;
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      dispatch({ type: "dragStart", target: pointAt(event) });
    },
    [pointAt],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!draggingRef.current) return;
      dispatch({ type: "dragMove", target: pointAt(event) });
    },
    [pointAt],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      const target = pointAt(event);
      dispatch({ type: "drop", target });
      void solve(target);
    },
    [pointAt, solve],
  );

  const chosen = selectedSolution(state);
  const current = isSolutionCurrent(state);

  return (
    <div class="target-marker-panel" data-testid="target-marker-panel">
      <div
        class="target-plot"
        data-testid="target-plot"
        style={{ width: `${viewport.width}px`, height: `${viewport.height}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span
          class="target-marker"
          data-testid="target-marker"
          data-dragging={state.status === "dragging" ? "true" : "false"}
          data-downrange={state.target.downrange}
          data-height={state.target.height}
        />
      </div>

      <p class="target-status" data-testid="target-status" data-status={state.status}>
        {summarizeTarget(state)}
      </p>

      <fieldset class="target-arc-choice" data-testid="target-arc-choice">
        <legend>Arc</legend>
        {ARCS.map((arc) => (
          <label key={arc.key} data-testid={`target-arc-${arc.key}`}>
            <input
              type="radio"
              name="target-arc"
              value={arc.key}
              checked={state.arc === arc.key}
              onChange={() => dispatch({ type: "chooseArc", arc: arc.key })}
            />
            {arc.label}
          </label>
        ))}
      </fieldset>

      {/*
        The aim is shown only while it describes the marker's current position.
        A solved aim next to a marker the user has since dragged elsewhere reads
        as the answer to the question they are asking now, which it is not; the
        status line says the marker has moved, and this stays out of the way.
      */}
      {chosen !== undefined && current && (
        <dl class="target-aim" data-testid="target-aim">
          <dt>elevation</dt>
          <dd data-testid="target-aim-theta">{((chosen.aim.theta * 180) / Math.PI).toFixed(2)}°</dd>
          <dt>speed</dt>
          <dd data-testid="target-aim-speed">{chosen.aim.speed.toFixed(1)} m/s</dd>
          <dt>time of flight</dt>
          <dd data-testid="target-aim-tof">{chosen.timeOfFlight.toFixed(2)} s</dd>
          <dt>downrange miss</dt>
          <dd data-testid="target-aim-miss">{chosen.downrangeMiss.toFixed(3)} m</dd>
        </dl>
      )}

      <p class="target-latency" data-testid="target-latency" aria-live="polite">
        {formatLatency(state)}
      </p>

      <p class="target-readout" data-testid="target-readout">
        {formatTarget(state.target)}
        {isSolving(state) ? " — solving…" : ""}
      </p>
    </div>
  );
}
