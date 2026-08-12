/**
 * State for the basin-of-attraction map (P5.20). Split from the component for
 * the reason every `*-panel-logic.ts` in this package is: the interesting part
 * is a small state machine plus some formatting, and both are worth testing
 * without rendering anything.
 *
 * The panel is deliberately thinner than P5.18/P5.19's convergence trace, and
 * the difference is in the shape of the work rather than in the effort spent.
 * A convergence trace streams: rows arrive one at a time and the reducer's job
 * is to survive their orderings against a cancel. A basin sweep is `n²`
 * independent Newton solves that produce nothing worth showing until the last
 * one lands — a half-drawn map is not a partial answer, it is a misleading
 * one — so there is a single result, and the only orderings to get right are
 * around cancellation and a superseded run.
 */

import { boundaryFraction, censusOf, type BasinCensus, type BasinGrid } from "@ballista/analysis";

/** Where a sweep is in its lifecycle. */
export type BasinStatus =
  /** Nothing has been swept yet. */
  | "idle"
  /** A sweep is in flight. */
  | "running"
  /** A grid arrived. */
  | "ready"
  /** The user cancelled it. Any previous grid is kept — see {@link basinReducer}. */
  | "cancelled"
  /** The sweep threw rather than returning a grid. */
  | "failed";

export interface BasinState {
  readonly status: BasinStatus;
  readonly grid?: BasinGrid;
  readonly error?: string;
}

export const initialBasinState: BasinState = { status: "idle" };

export type BasinAction =
  | { readonly type: "start" }
  | { readonly type: "ready"; readonly grid: BasinGrid }
  | { readonly type: "cancelled" }
  | { readonly type: "failed"; readonly error: string };

/**
 * The sweep state machine.
 *
 * **A cancelled or failed sweep keeps the grid already on screen**, which is
 * the opposite of what `traceReducer` does with its rows, and the difference is
 * deliberate. Interleaving two solves' rows in one table would read as a single
 * solve that got worse, so a new run there clears. A basin map is a whole
 * picture at a time: the one being displayed is still a true map of the grid it
 * was swept on, and blanking it because a *later* sweep was abandoned would
 * throw away the only correct thing on screen. `status` says which case the
 * reader is looking at.
 */
export function basinReducer(state: BasinState, action: BasinAction): BasinState {
  switch (action.type) {
    case "start":
      // Rebuilt rather than spread so a previous run's `error` is *absent*,
      // not present-and-undefined — `exactOptionalPropertyTypes` is on, and
      // the two are different types here.
      return state.grid === undefined
        ? { status: "running" }
        : { status: "running", grid: state.grid };
    case "ready":
      if (state.status !== "running") return state;
      return { status: "ready", grid: action.grid };
    case "cancelled":
      if (state.status !== "running") return state;
      return { ...state, status: "cancelled" };
    case "failed":
      if (state.status !== "running") return state;
      return { ...state, status: "failed", error: action.error };
  }
}

/** True while a sweep is in flight — i.e. while Cancel means something. */
export function isSweeping(state: BasinState): boolean {
  return state.status === "running";
}

/** A one-line summary of the sweep, for a status line. */
export function summarizeSweep(state: BasinState): string {
  switch (state.status) {
    case "idle":
      return "Not swept yet.";
    case "running":
      return "Sweeping…";
    case "failed":
      return `Failed: ${state.error ?? "unknown error"}`;
    case "cancelled":
      return state.grid === undefined
        ? "Cancelled before any grid was produced."
        : "Cancelled. Showing the previous sweep.";
    case "ready": {
      const grid = state.grid;
      if (grid === undefined) return "Finished.";
      const census = censusOf(grid);
      return (
        `${census.total} starting guesses: ${census.low} low, ${census.high} high` +
        `${census.unconverged > 0 ? `, ${census.unconverged} unconverged` : ""}` +
        `${census.failed > 0 ? `, ${census.failed} unreachable` : ""}` +
        ` (${grid.evaluations} trajectory integrations).`
      );
    }
  }
}

/**
 * The boundary readout under the map — P5.20's "boundary structure noted",
 * rendered as the measurement it is.
 *
 * **It reports boundary cells per row, not the raw fraction.** The fraction
 * shrinks as the grid is refined even when nothing about the boundary changed —
 * a boundary of `k` cells per row is `k·rows` cells out of `rows·columns`, so
 * the fraction is `k/columns`. Dividing the boundary cell *count* by the number
 * of rows recovers `k`, which means the same thing at every resolution and can
 * therefore be compared across sweeps by eye. A single smooth curve, crossed
 * once per row, sits at 2.
 *
 * The count is recovered as `fraction × labelled` rather than as
 * `fraction × columns` because {@link boundaryFraction} is taken over
 * *arc-labelled* cells only; on a grid with unreachable or unconverged cells
 * those two are not the same number, and only the first is the count.
 *
 * **It states the comparison and stops.** It does not print "smooth" or
 * "fractal": that verdict needs several resolutions, and this string has one.
 * `basin-of-attraction.test.ts` is where the multi-level measurement lives.
 */
export function formatBoundary(grid: BasinGrid | undefined): string {
  if (grid === undefined) return "boundary: no sweep yet";
  const rows = grid.speeds.length;
  const fraction = boundaryFraction(grid);
  if (fraction === 0 || rows === 0) {
    return "boundary: none in this grid — one basin, or too coarse to resolve";
  }
  const census = censusOf(grid);
  const perRow = (fraction * (census.low + census.high)) / rows;
  return `boundary: ${perRow.toFixed(2)} cells per row (2.00 is a single smooth curve)`;
}

/** The census, for a legend that counts what it colours. `undefined` before the first sweep. */
export function censusFor(grid: BasinGrid | undefined): BasinCensus | undefined {
  return grid === undefined ? undefined : censusOf(grid);
}
