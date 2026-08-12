import { describe, expect, it } from "vitest";
import type { BasinGrid, BasinOutcome } from "@ballista/analysis";
import {
  basinReducer,
  censusFor,
  formatBoundary,
  initialBasinState,
  isSweeping,
  summarizeSweep,
  type BasinState,
} from "./basin-panel-logic.js";

const GLYPHS: Record<string, BasinOutcome> = {
  L: "low",
  H: "high",
  ".": "unconverged",
  x: "failed",
};

/** Builds a {@link BasinGrid} from a picture of it, one string per row. */
function gridOf(...rows: readonly string[]): BasinGrid {
  const outcomes = rows.map((row) => [...row].map((glyph) => GLYPHS[glyph]!));
  return {
    thetas: outcomes[0]!.map((_, index) => index),
    speeds: outcomes.map((_, index) => index),
    outcomes,
    cells: outcomes.flatMap((row, rowIndex) =>
      row.map((outcome, column) => ({
        column,
        row: rowIndex,
        start: { theta: column, speed: rowIndex },
        outcome,
        solution: null,
        downrangeMiss: null,
        rangeSlope: null,
        iterations: 0,
      })),
    ),
    evaluations: 1234,
  };
}

const READY = (grid: BasinGrid): BasinState => ({ status: "ready", grid });

describe("basinReducer", () => {
  it("starts idle and goes running on start", () => {
    expect(initialBasinState.status).toBe("idle");
    expect(basinReducer(initialBasinState, { type: "start" }).status).toBe("running");
  });

  it("clears a previous error when a new sweep starts", () => {
    const failed: BasinState = { status: "failed", error: "boom" };

    expect(basinReducer(failed, { type: "start" }).error).toBeUndefined();
  });

  it("takes the grid a running sweep produced", () => {
    const grid = gridOf("LH");
    const next = basinReducer({ status: "running" }, { type: "ready", grid });

    expect(next).toEqual({ status: "ready", grid });
  });

  it("drops a grid that arrives after the sweep was cancelled", () => {
    // The sweep can finish in the window between the click and the abort. The
    // user's action is the thing being reported, so the cancel wins.
    const cancelled: BasinState = { status: "cancelled", grid: gridOf("LL") };
    const next = basinReducer(cancelled, { type: "ready", grid: gridOf("HH") });

    expect(next).toBe(cancelled);
  });

  it("keeps the displayed grid when a later sweep is cancelled or fails", () => {
    // Deliberately unlike traceReducer, which clears its rows on a new run.
    // A map on screen is still a true map of the grid it was swept on;
    // blanking it because a *later* sweep was abandoned would throw away the
    // only correct thing on screen.
    const grid = gridOf("LLHH");
    const running = basinReducer(READY(grid), { type: "start" });

    expect(basinReducer(running, { type: "cancelled" }).grid).toBe(grid);
    expect(basinReducer(running, { type: "failed", error: "worker died" }).grid).toBe(grid);
  });

  it("ignores a settle, cancel or failure when nothing is running", () => {
    for (const action of [
      { type: "cancelled" },
      { type: "failed", error: "x" },
      { type: "ready", grid: gridOf("L") },
    ] as const) {
      expect(basinReducer(initialBasinState, action)).toBe(initialBasinState);
    }
  });
});

describe("isSweeping", () => {
  it("is true only while a sweep is in flight", () => {
    expect(isSweeping({ status: "running" })).toBe(true);
    for (const status of ["idle", "ready", "cancelled", "failed"] as const) {
      expect(isSweeping({ status })).toBe(false);
    }
  });
});

describe("summarizeSweep", () => {
  it("counts each outcome and the integrations they cost", () => {
    expect(summarizeSweep(READY(gridOf("LLHH", "LL.x")))).toBe(
      "8 starting guesses: 4 low, 2 high, 1 unconverged, 1 unreachable (1234 trajectory integrations).",
    );
  });

  it("omits the failure counts when there are none, rather than printing zeroes", () => {
    expect(summarizeSweep(READY(gridOf("LH")))).toBe(
      "2 starting guesses: 1 low, 1 high (1234 trajectory integrations).",
    );
  });

  it("distinguishes a cancel that kept a map from one that had nothing to keep", () => {
    expect(summarizeSweep({ status: "cancelled", grid: gridOf("LH") })).toBe(
      "Cancelled. Showing the previous sweep.",
    );
    expect(summarizeSweep({ status: "cancelled" })).toBe("Cancelled before any grid was produced.");
  });

  it("reports the error text of a failure", () => {
    expect(summarizeSweep({ status: "failed", error: "worker died" })).toBe("Failed: worker died");
  });

  it("says so before the first sweep and while one is running", () => {
    expect(summarizeSweep(initialBasinState)).toBe("Not swept yet.");
    expect(summarizeSweep({ status: "running" })).toBe("Sweeping…");
  });
});

describe("formatBoundary", () => {
  it("reports boundary cells per row, which means the same thing at every resolution", () => {
    // A single vertical seam: two cells per row touch it, at any grid size.
    expect(formatBoundary(gridOf("LLHH", "LLHH", "LLHH", "LLHH"))).toBe(
      "boundary: 2.00 cells per row (2.00 is a single smooth curve)",
    );
    expect(formatBoundary(gridOf("LLLHHH", "LLLHHH"))).toBe(
      "boundary: 2.00 cells per row (2.00 is a single smooth curve)",
    );
  });

  it("reports more than two per row for a boundary with detail in it", () => {
    // Speckle: an isolated high cell inside the low basin adds boundary.
    expect(formatBoundary(gridOf("LLHH", "LHLH", "LLHH", "LLHH"))).not.toBe(
      "boundary: 2.00 cells per row (2.00 is a single smooth curve)",
    );
  });

  it("says there is no boundary rather than printing 0.00 cells per row", () => {
    expect(formatBoundary(gridOf("LLL", "LLL"))).toBe(
      "boundary: none in this grid — one basin, or too coarse to resolve",
    );
  });

  it("has nothing to report before the first sweep", () => {
    expect(formatBoundary(undefined)).toBe("boundary: no sweep yet");
  });
});

describe("censusFor", () => {
  it("is undefined until there is a grid to count", () => {
    expect(censusFor(undefined)).toBeUndefined();
    expect(censusFor(gridOf("LLH"))).toEqual({
      low: 2,
      high: 1,
      unconverged: 0,
      failed: 0,
      total: 3,
    });
  });
});
