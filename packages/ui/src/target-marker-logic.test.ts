/**
 * P5.21's state machine and coordinate transform. The latency half of the
 * criterion ("drag→solution < 200 ms typical, measured") is not here — it needs
 * real trajectory integrations, so it lives next to the solver in
 * `packages/analysis/src/arcs.test.ts`. What this file pins is everything that
 * decides *whether the right solve is issued and the right answer displayed*,
 * which is the part a fast solver cannot rescue.
 */

import { describe, expect, it } from "vitest";
import type { ArcPair, ArcSolution } from "@ballista/analysis";
import {
  DRAG_TO_SOLUTION_BUDGET_MS,
  formatLatency,
  formatTarget,
  initialTargetState,
  isReachable,
  isSolutionCurrent,
  isSolving,
  selectedSolution,
  summarizeTarget,
  targetReducer,
  worldFromPointer,
  type PlotViewport,
  type TargetState,
} from "./target-marker-logic.js";

const VIEWPORT: PlotViewport = {
  width: 400,
  height: 200,
  downrangeRange: [0, 200],
  heightRange: [0, 100],
};

function solution(arc: "low" | "high", theta: number): ArcSolution {
  return {
    arc,
    aim: { theta, speed: 60 },
    residual: {
      miss: [0, 0],
      norm: 0,
      impact: { time: 1, state: [0, 0, 0, 0] },
    } as unknown as ArcSolution["residual"],
    downrangeMiss: 0,
    timeOfFlight: arc === "low" ? 4 : 9,
    iterations: 7,
  };
}

function pair(overrides: Partial<ArcPair> = {}): ArcPair {
  return {
    reachable: true,
    low: solution("low", 0.3),
    high: solution("high", 1.1),
    peakAngle: 0.7,
    maxDownrange: 300,
    evaluations: 40,
    ...overrides,
  } as ArcPair;
}

const AT_ORIGIN = initialTargetState({ downrange: 100, height: 0 });

describe("worldFromPointer", () => {
  it("maps the box corners onto the axis bounds", () => {
    expect(worldFromPointer({ x: 0, y: 200 }, VIEWPORT)).toEqual({ downrange: 0, height: 0 });
    expect(worldFromPointer({ x: 400, y: 0 }, VIEWPORT)).toEqual({ downrange: 200, height: 100 });
  });

  it("flips the vertical axis but not the horizontal one", () => {
    // Pointer y grows downward; world height grows upward. A quarter of the way
    // down the box is three quarters of the way up the world.
    const point = worldFromPointer({ x: 100, y: 50 }, VIEWPORT);

    expect(point.downrange).toBeCloseTo(50, 12);
    expect(point.height).toBeCloseTo(75, 12);
  });

  it("honours a non-zero axis origin rather than assuming the world starts at 0", () => {
    const shifted: PlotViewport = {
      ...VIEWPORT,
      downrangeRange: [100, 300],
      heightRange: [-50, 50],
    };

    expect(worldFromPointer({ x: 200, y: 100 }, shifted)).toEqual({ downrange: 200, height: 0 });
  });

  it("does not clamp a pointer that left the box", () => {
    // The pointer is captured during a drag, so leaving the plot is normal.
    // Pinning to the edge would silently misreport where the user dropped.
    const point = worldFromPointer({ x: 500, y: -40 }, VIEWPORT);

    expect(point.downrange).toBeCloseTo(250, 12);
    expect(point.height).toBeCloseTo(120, 12);
  });

  it("rejects a degenerate viewport rather than returning Infinity or NaN", () => {
    expect(() => worldFromPointer({ x: 1, y: 1 }, { ...VIEWPORT, width: 0 })).toThrow(/positive/);
    expect(() => worldFromPointer({ x: 1, y: 1 }, { ...VIEWPORT, height: -5 })).toThrow(/positive/);
    expect(() =>
      worldFromPointer({ x: 1, y: 1 }, { ...VIEWPORT, downrangeRange: [50, 50] }),
    ).toThrow(/downrangeRange/);
    expect(() =>
      worldFromPointer({ x: 1, y: 1 }, { ...VIEWPORT, heightRange: [0, Infinity] }),
    ).toThrow(/heightRange/);
  });
});

describe("targetReducer", () => {
  it("follows the pointer through a drag without issuing a solve", () => {
    let state = targetReducer(AT_ORIGIN, { type: "dragStart", target: AT_ORIGIN.target });
    state = targetReducer(state, { type: "dragMove", target: { downrange: 150, height: 10 } });

    expect(state.status).toBe("dragging");
    expect(state.target).toEqual({ downrange: 150, height: 10 });
    expect(isSolving(state)).toBe(false);
  });

  it("enters the solving state only on drop", () => {
    const dragging = targetReducer(AT_ORIGIN, { type: "dragStart", target: AT_ORIGIN.target });
    const dropped = targetReducer(dragging, {
      type: "drop",
      target: { downrange: 140, height: 0 },
    });

    expect(dropped.status).toBe("solving");
    expect(isSolving(dropped)).toBe(true);
    expect(dropped.target).toEqual({ downrange: 140, height: 0 });
  });

  it("records the solution and the latency the drop actually took", () => {
    const dropped = targetReducer(AT_ORIGIN, {
      type: "drop",
      target: { downrange: 140, height: 0 },
    });
    const ready = targetReducer(dropped, { type: "solved", arcs: pair(), latencyMs: 42 });

    expect(ready.status).toBe("ready");
    expect(ready.latencyMs).toBe(42);
    expect(ready.solvedFor).toEqual({ downrange: 140, height: 0 });
    expect(isSolutionCurrent(ready)).toBe(true);
  });

  it("keeps the previous solution on screen when a new drag starts, marked stale", () => {
    const ready = targetReducer(
      targetReducer(AT_ORIGIN, { type: "drop", target: { downrange: 140, height: 0 } }),
      { type: "solved", arcs: pair(), latencyMs: 30 },
    );
    const draggingAgain = targetReducer(ready, {
      type: "dragMove",
      target: { downrange: 180, height: 0 },
    });

    expect(draggingAgain.arcs).toBeDefined();
    expect(draggingAgain.solvedFor).toEqual({ downrange: 140, height: 0 });
    expect(isSolutionCurrent(draggingAgain)).toBe(false);
  });

  it("calls a solution current again if the drag returns to the exact solved point", () => {
    // Compared by value, not reference: the same point is the same point.
    const ready = targetReducer(
      targetReducer(AT_ORIGIN, { type: "drop", target: { downrange: 140, height: 0 } }),
      { type: "solved", arcs: pair(), latencyMs: 30 },
    );
    const back = targetReducer(ready, { type: "dragMove", target: { downrange: 140, height: 0 } });

    expect(isSolutionCurrent(back)).toBe(true);
  });

  it("drops a solve that lands after the user has started dragging again", () => {
    // Its answer describes a point the marker has left; the next drop will
    // issue its own solve.
    const dropped = targetReducer(AT_ORIGIN, {
      type: "drop",
      target: { downrange: 140, height: 0 },
    });
    const draggingAgain = targetReducer(dropped, {
      type: "dragMove",
      target: { downrange: 190, height: 0 },
    });
    const late = targetReducer(draggingAgain, { type: "solved", arcs: pair(), latencyMs: 500 });

    expect(late).toBe(draggingAgain);
    expect(late.arcs).toBeUndefined();
  });

  it("ignores a failure that is not answering the current solve", () => {
    const dragging = targetReducer(AT_ORIGIN, { type: "dragStart", target: AT_ORIGIN.target });
    const late = targetReducer(dragging, { type: "failed", error: "boom" });

    expect(late).toBe(dragging);
    expect(late.status).toBe("dragging");
  });

  it("records a failure that does answer the current solve", () => {
    const dropped = targetReducer(AT_ORIGIN, {
      type: "drop",
      target: { downrange: 140, height: 0 },
    });
    const failed = targetReducer(dropped, { type: "failed", error: "no impact" });

    expect(failed.status).toBe("failed");
    expect(summarizeTarget(failed)).toContain("no impact");
  });

  it("preserves the arc choice across a later solve", () => {
    // A user who wants the lofted shot means it for the next target too.
    let state = targetReducer(AT_ORIGIN, { type: "chooseArc", arc: "high" });
    state = targetReducer(state, { type: "drop", target: { downrange: 140, height: 0 } });
    state = targetReducer(state, { type: "solved", arcs: pair(), latencyMs: 20 });

    expect(state.arc).toBe("high");
    expect(selectedSolution(state)?.aim.theta).toBeCloseTo(1.1, 12);
  });

  it("reports no selected solution when the chosen arc does not exist at this target", () => {
    // An angle bound can exclude one arc while the other is still there to fire.
    const state = targetReducer(
      targetReducer(AT_ORIGIN, { type: "drop", target: { downrange: 140, height: 0 } }),
      { type: "solved", arcs: pair({ high: null }), latencyMs: 20 },
    );
    const wantingHigh = targetReducer(state, { type: "chooseArc", arc: "high" });

    expect(selectedSolution(wantingHigh)).toBeUndefined();
    expect(
      selectedSolution(targetReducer(wantingHigh, { type: "chooseArc", arc: "low" })),
    ).toBeDefined();
  });
});

describe("readouts", () => {
  it("formats a target in metres to one decimal", () => {
    expect(formatTarget({ downrange: 140.44, height: 2.62 })).toBe("140.4 m downrange, 2.6 m up");
    expect(formatTarget({ downrange: -3.14, height: 0 })).toBe("-3.1 m downrange, 0.0 m up");
  });

  it("says there is no latency to report before the first solve", () => {
    expect(formatLatency(AT_ORIGIN)).toBe("no solve yet");
  });

  it("states the measured latency against the budget, both ways", () => {
    const under = { ...AT_ORIGIN, latencyMs: 37 } as TargetState;
    const over = { ...AT_ORIGIN, latencyMs: 640 } as TargetState;

    expect(formatLatency(under)).toContain("37 ms");
    expect(formatLatency(under)).toContain(`within the ${DRAG_TO_SOLUTION_BUDGET_MS} ms budget`);
    expect(formatLatency(over)).toContain(`over the ${DRAG_TO_SOLUTION_BUDGET_MS} ms budget`);
  });

  it("reports an unreachable target as unreachable rather than as zero arcs", () => {
    const state = targetReducer(
      targetReducer(AT_ORIGIN, { type: "drop", target: { downrange: 9000, height: 0 } }),
      { type: "solved", arcs: pair({ reachable: false, low: null, high: null }), latencyMs: 15 },
    );

    expect(isReachable(state)).toBe(false);
    expect(summarizeTarget(state)).toContain("beyond the reachable set");
  });

  it("notes in the summary when the marker has moved away from the solution", () => {
    const ready = targetReducer(
      targetReducer(AT_ORIGIN, { type: "drop", target: { downrange: 140, height: 0 } }),
      { type: "solved", arcs: pair(), latencyMs: 30 },
    );
    const moved = targetReducer(ready, { type: "dragMove", target: { downrange: 141, height: 0 } });

    expect(summarizeTarget(ready)).not.toContain("has moved");
    // The summary of a stale-but-ready state is reachable only via the ready
    // branch, so assert on a state that kept its arcs and changed its target.
    expect(summarizeTarget({ ...moved, status: "ready" })).toContain("has moved");
  });

  it("covers the idle, dragging and solving lines", () => {
    expect(summarizeTarget(AT_ORIGIN)).toContain("Drag it to solve");
    expect(
      summarizeTarget(targetReducer(AT_ORIGIN, { type: "dragStart", target: AT_ORIGIN.target })),
    ).toContain("Dragging to");
    expect(
      summarizeTarget(targetReducer(AT_ORIGIN, { type: "drop", target: AT_ORIGIN.target })),
    ).toContain("Solving for");
  });
});
