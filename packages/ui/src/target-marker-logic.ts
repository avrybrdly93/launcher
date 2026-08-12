/**
 * State for the draggable target marker (P5.21): the user drags a marker across
 * the trajectory plot, drops it, and the solver answers with the two aims that
 * reach it. Split from the component for the reason every `*-panel-logic.ts` in
 * this package is — the interesting part is a state machine plus a coordinate
 * transform, and both are worth testing without rendering anything.
 *
 * **Solving happens on drop, not during the drag, and that is a numerical
 * decision rather than a UI preference.** A pointer move fires tens of times a
 * second; each solve is a pair of Brent root-finds over full trajectory
 * integrations (P5.08), which P5.21's own measurement puts in the tens of
 * milliseconds. Solving per move would queue work faster than it retires and
 * the marker would lag the pointer by a growing margin — the classic way to
 * make a fast solver feel slow. Dragging is therefore pure state, and exactly
 * one solve is issued per drop.
 *
 * **The drag is tracked in world coordinates, not pixels.** The pointer arrives
 * in pixels and {@link worldFromPointer} converts once, at the boundary; every
 * state field below is metres. Keeping pixels in the state would make the
 * meaning of a stored position depend on the plot's current size, so a resize
 * mid-drag would silently move the target.
 */

import type { ArcLabel, ArcPair } from "@ballista/analysis";

/** A point on the ground plane the marker can occupy, in metres. */
export interface TargetPoint {
  /** Downrange from the launch point, metres. */
  readonly downrange: number;
  /** Height above the launch point, metres. */
  readonly height: number;
}

/** The plot's pixel box and the world range it displays, for {@link worldFromPointer}. */
export interface PlotViewport {
  /** Pixel width of the plotting area. Must be positive. */
  readonly width: number;
  /** Pixel height of the plotting area. Must be positive. */
  readonly height: number;
  /** World downrange at the left edge and right edge, metres. */
  readonly downrangeRange: readonly [number, number];
  /** World height at the *bottom* edge and top edge, metres. */
  readonly heightRange: readonly [number, number];
}

/**
 * Convert a pointer offset within the plot box to world metres.
 *
 * **The vertical axis is flipped and the horizontal one is not.** Pointer `y`
 * grows downward from the top of the box; world height grows upward. Getting
 * this wrong produces a marker that tracks the pointer perfectly in `x` and
 * mirrors it in `y`, which is the kind of bug that looks like a physics error
 * from a screenshot, so it is asserted directly in the tests.
 *
 * The result is **not** clamped to the viewport. A drag can legitimately leave
 * the box — the pointer is captured for the duration — and clamping here would
 * silently pin the marker to an edge rather than letting {@link isReachable}'s
 * caller report an out-of-range target honestly.
 *
 * @throws If the viewport has a non-positive dimension or a degenerate axis
 *   range, both of which would divide by zero and yield `Infinity`/`NaN`
 *   coordinates rather than an obviously wrong picture.
 */
export function worldFromPointer(
  pointer: { readonly x: number; readonly y: number },
  viewport: PlotViewport,
): TargetPoint {
  const { width, height, downrangeRange, heightRange } = viewport;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(
      `worldFromPointer: viewport must have positive finite dimensions; got ${width}x${height}`,
    );
  }
  const [left, right] = downrangeRange;
  const [bottom, top] = heightRange;
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) {
    throw new Error(`worldFromPointer: downrangeRange must be a non-degenerate finite interval`);
  }
  if (!Number.isFinite(bottom) || !Number.isFinite(top) || bottom === top) {
    throw new Error(`worldFromPointer: heightRange must be a non-degenerate finite interval`);
  }
  return {
    downrange: left + (pointer.x / width) * (right - left),
    // 1 - y/height, because pointer y is measured downward from the top edge.
    height: bottom + (1 - pointer.y / height) * (top - bottom),
  };
}

/** Where the marker is in its lifecycle. */
export type TargetStatus =
  /** Sitting still; no solve has been asked for. */
  | "idle"
  /** The pointer is down and the marker is following it. No solve is in flight. */
  | "dragging"
  /** Dropped, and the solve for that drop has not answered yet. */
  | "solving"
  /** A solve answered. See {@link TargetState.arcs}. */
  | "ready"
  /** The solve threw. */
  | "failed";

export interface TargetState {
  readonly status: TargetStatus;
  /** Where the marker is now — it follows the pointer during a drag. */
  readonly target: TargetPoint;
  /**
   * The target the displayed {@link arcs} were solved for.
   *
   * Kept separately from {@link target} because they come apart the moment the
   * user starts a second drag: the marker has moved, the arcs on screen have
   * not, and a reader needs to know the solution belongs to the old point.
   */
  readonly solvedFor?: TargetPoint;
  /** The last solve's answer, or `undefined` before the first one. */
  readonly arcs?: ArcPair;
  /** Which arc the user has selected. Preserved across solves — see {@link targetReducer}. */
  readonly arc: ArcLabel;
  /** Wall-clock milliseconds from drop to answer, for the P5.21 readout. */
  readonly latencyMs?: number;
  readonly error?: string;
}

export function initialTargetState(target: TargetPoint): TargetState {
  return { status: "idle", target, arc: "low" };
}

export type TargetAction =
  | { readonly type: "dragStart"; readonly target: TargetPoint }
  | { readonly type: "dragMove"; readonly target: TargetPoint }
  | { readonly type: "drop"; readonly target: TargetPoint }
  | { readonly type: "solved"; readonly arcs: ArcPair; readonly latencyMs: number }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "chooseArc"; readonly arc: ArcLabel };

/**
 * The marker state machine.
 *
 * **A new drag keeps the previous solution on screen and marks it stale rather
 * than clearing it.** `solvedFor` says which point the arcs belong to, so the
 * view can render them dimmed next to the moving marker. Blanking the plot the
 * instant the pointer goes down would throw away the only correct thing on
 * screen for the whole duration of a drag, and a drag is exactly when a user
 * wants to compare where they are going against where they were — the same
 * argument `basinReducer` makes for keeping a superseded map.
 *
 * **A `solved` that arrives while the user is already dragging again is
 * dropped.** Its answer describes a point the marker has left, and the next
 * drop will issue its own solve; accepting it would repaint arcs to a target
 * the user can see they are no longer pointing at. The guard is `status !==
 * "solving"`, which covers both that case and a stale solve racing a newer one.
 *
 * **The arc choice survives everything.** A user who has decided they want the
 * lofted shot means it for the next target too, so `chooseArc` is the only
 * thing that changes `arc`.
 */
export function targetReducer(state: TargetState, action: TargetAction): TargetState {
  switch (action.type) {
    case "dragStart":
    case "dragMove":
      return { ...state, status: "dragging", target: action.target };
    case "drop":
      return { ...state, status: "solving", target: action.target };
    case "solved": {
      if (state.status !== "solving") return state;
      return {
        status: "ready",
        target: state.target,
        solvedFor: state.target,
        arcs: action.arcs,
        arc: state.arc,
        latencyMs: action.latencyMs,
      };
    }
    case "failed": {
      if (state.status !== "solving") return state;
      return { ...state, status: "failed", error: action.error };
    }
    case "chooseArc":
      return { ...state, arc: action.arc };
  }
}

/** True while a drop's solve is outstanding. */
export function isSolving(state: TargetState): boolean {
  return state.status === "solving";
}

/**
 * True when the arcs on screen describe the marker's current position.
 *
 * Compared by value rather than by reference: a drag that returns to the exact
 * point it started from has produced an identical target, and calling that
 * stale would be a lie about the picture.
 */
export function isSolutionCurrent(state: TargetState): boolean {
  const solved = state.solvedFor;
  if (solved === undefined) return false;
  return solved.downrange === state.target.downrange && solved.height === state.target.height;
}

/** The selected arc's solution, or `undefined` when it does not exist at this target. */
export function selectedSolution(state: TargetState) {
  return state.arcs?.[state.arc] ?? undefined;
}

/** Whether the last solve found the target within reach at its launch speed. */
export function isReachable(state: TargetState): boolean {
  return state.arcs?.reachable ?? false;
}

/** Formats a world point for a readout. Metres, one decimal — sub-decimetre aim is not a claim. */
export function formatTarget(target: TargetPoint): string {
  return `${target.downrange.toFixed(1)} m downrange, ${target.height.toFixed(1)} m up`;
}

/**
 * The drag→solution latency readout — P5.21's validation criterion, shown as
 * the measurement it is rather than asserted in prose.
 *
 * The budget is stated alongside the number so a reader can see the comparison
 * without knowing the criterion, and the number is the one this drop actually
 * took, not a running average: an average would hide exactly the slow drop the
 * budget exists to catch.
 */
export const DRAG_TO_SOLUTION_BUDGET_MS = 200;

export function formatLatency(state: TargetState): string {
  const latency = state.latencyMs;
  if (latency === undefined) return "no solve yet";
  const verdict = latency < DRAG_TO_SOLUTION_BUDGET_MS ? "within" : "over";
  return `drag→solution ${latency.toFixed(0)} ms (${verdict} the ${DRAG_TO_SOLUTION_BUDGET_MS} ms budget)`;
}

/** A one-line summary of the marker's state, for a status line. */
export function summarizeTarget(state: TargetState): string {
  switch (state.status) {
    case "idle":
      return `Target at ${formatTarget(state.target)}. Drag it to solve.`;
    case "dragging":
      return `Dragging to ${formatTarget(state.target)}…`;
    case "solving":
      return `Solving for ${formatTarget(state.target)}…`;
    case "failed":
      return `Failed: ${state.error ?? "unknown error"}`;
    case "ready": {
      const arcs = state.arcs;
      if (arcs === undefined) return "Finished.";
      if (!arcs.reachable) {
        return `${formatTarget(state.target)} is beyond the reachable set at this speed.`;
      }
      const available = [arcs.low ? "low" : null, arcs.high ? "high" : null].filter(
        (label): label is string => label !== null,
      );
      const stale = isSolutionCurrent(state) ? "" : " (marker has moved since)";
      return `${available.length} arc(s) to ${formatTarget(state.target)}: ${available.join(", ")}${stale}.`;
    }
  }
}
