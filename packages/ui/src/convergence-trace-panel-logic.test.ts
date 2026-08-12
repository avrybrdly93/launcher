import { describe, expect, it } from "vitest";
import type { OptimizeIteration, OptimizeJobResult } from "@ballista/runtime";
import {
  formatMerit,
  formatSlopeRatio,
  initialTraceState,
  isRunning,
  summarize,
  toTraceRow,
  traceMeritPoints,
  traceReducer,
  traceSlopeRatio,
  type TraceRow,
  type TraceState,
} from "./convergence-trace-panel-logic.js";

function iteration(index: number, nextMerit: number, alpha = 1): OptimizeIteration {
  return {
    step: {
      iteration: index,
      merit: nextMerit * 10,
      rank: 1,
      singularValues: [12, 3e-12],
      alpha,
      backtracks: 0,
      stepNorm: 0.01,
      predictedReduction: nextMerit * 9,
      nextMerit,
    },
    aim: { theta: 0.5 + index * 0.01, speed: 130 - index },
  };
}

const RESULT: OptimizeJobResult = {
  converged: true,
  status: "converged",
  aim: { theta: 0.63, speed: 104.9 },
  merit: 4e-13,
  iterations: 3,
  evaluations: 12,
};

function run(actions: Parameters<typeof traceReducer>[1][]): TraceState {
  return actions.reduce(traceReducer, initialTraceState);
}

describe("traceReducer", () => {
  it("starts idle with no rows", () => {
    expect(initialTraceState.status).toBe("idle");
    expect(initialTraceState.rows).toEqual([]);
    expect(isRunning(initialTraceState)).toBe(false);
  });

  it("appends a row per iteration while running, in arrival order", () => {
    const state = run([
      { type: "start" },
      { type: "iteration", iteration: iteration(0, 50) },
      { type: "iteration", iteration: iteration(1, 2) },
      { type: "iteration", iteration: iteration(2, 1e-9) },
    ]);
    expect(state.status).toBe("running");
    expect(state.rows.map((r) => r.iteration)).toEqual([0, 1, 2]);
    expect(state.rows.map((r) => r.nextMerit)).toEqual([50, 2, 1e-9]);
  });

  it("ignores iterations that arrive before a run has started", () => {
    const state = traceReducer(initialTraceState, {
      type: "iteration",
      iteration: iteration(0, 1),
    });
    expect(state).toBe(initialTraceState);
  });

  it("drops iterations that arrive after a cancel, which is a real race", () => {
    // The worker's already-queued messages do not vanish the moment the user
    // clicks: a trace that kept growing afterwards would misreport what is
    // running.
    const state = run([
      { type: "start" },
      { type: "iteration", iteration: iteration(0, 50) },
      { type: "cancelled" },
      { type: "iteration", iteration: iteration(1, 2) },
    ]);
    expect(state.status).toBe("cancelled");
    expect(state.rows).toHaveLength(1);
  });

  it("a cancel beats a result that lands in the same tick", () => {
    const state = run([
      { type: "start" },
      { type: "cancelled" },
      { type: "settled", result: RESULT },
    ]);
    expect(state.status).toBe("cancelled");
    expect(state.result).toBeUndefined();
  });

  it("keeps the rows a cancelled run already produced", () => {
    const state = run([
      { type: "start" },
      { type: "iteration", iteration: iteration(0, 50) },
      { type: "iteration", iteration: iteration(1, 2) },
      { type: "cancelled" },
    ]);
    expect(state.rows).toHaveLength(2);
  });

  it("a second run clears the first one's rows", () => {
    const first = run([
      { type: "start" },
      { type: "iteration", iteration: iteration(0, 50) },
      { type: "settled", result: RESULT },
    ]);
    const second = traceReducer(first, { type: "start" });
    expect(second.rows).toEqual([]);
    expect(second.status).toBe("running");
    expect(second.result).toBeUndefined();
  });

  it("records a failure without pretending it converged", () => {
    const state = run([{ type: "start" }, { type: "failed", error: "worker exploded" }]);
    expect(state.status).toBe("failed");
    expect(summarize(state)).toContain("worker exploded");
  });
});

describe("toTraceRow", () => {
  it("flattens the step and the aim into the columns the table shows", () => {
    const row = toTraceRow(iteration(2, 1e-9, 0.25));
    expect(row).toEqual({
      iteration: 2,
      merit: 1e-8,
      nextMerit: 1e-9,
      alpha: 0.25,
      rank: 1,
      theta: 0.52,
      speed: 128,
    });
  });
});

describe("formatMerit", () => {
  it("uses exponential notation so a converged tail is still readable", () => {
    // The whole reason for the format: a converging Newton trace ends around
    // 1e-13, which any fixed-decimal rendering shows as 0.000.
    expect(formatMerit(4.2e-13)).toBe("4.200e-13");
    expect(formatMerit(1234.5)).toBe("1.235e+3");
    expect(Number(formatMerit(4.2e-13))).toBeCloseTo(4.2e-13, 20);
  });

  it("passes non-finite values through rather than printing NaNe+0", () => {
    expect(formatMerit(Number.NaN)).toBe("NaN");
    expect(formatMerit(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("summarize", () => {
  it("counts iterations while running", () => {
    expect(summarize(run([{ type: "start" }]))).toBe("Solving…");
    expect(
      summarize(run([{ type: "start" }, { type: "iteration", iteration: iteration(0, 1) }])),
    ).toBe("Solving… 1 iterations");
  });

  it("reports a non-converged finish as such rather than as success", () => {
    const stalled: OptimizeJobResult = {
      ...RESULT,
      converged: false,
      status: "stalled",
      merit: 12.5,
    };
    const text = summarize(run([{ type: "start" }, { type: "settled", result: stalled }]));
    expect(text).toContain("stalled");
    expect(text).not.toContain("Converged");
    expect(text).toContain("1.250e+1");
  });

  it("reports a cancel with the count reached", () => {
    const state = run([
      { type: "start" },
      { type: "iteration", iteration: iteration(0, 50) },
      { type: "cancelled" },
    ]);
    expect(summarize(state)).toBe("Cancelled after 1 iterations.");
  });
});

/** A row as the panel would hold it, with both ends of the step given explicitly. */
function row(iteration: number, merit: number, nextMerit: number): TraceRow {
  return { iteration, merit, nextMerit, alpha: 1, rank: 1, theta: 0.5, speed: 100 };
}

describe("traceMeritPoints (P5.19)", () => {
  it("plots a step's nextMerit at the iterate it produced, not the one it started from", () => {
    // The alignment bug this guards against shifts the whole curve one
    // iteration left, making the solve look a step faster than it was.
    expect(traceMeritPoints([row(0, 66.16, 3.042), row(1, 3.042, 5.472e-3)])).toEqual([
      { iteration: 0, merit: 66.16 },
      { iteration: 1, merit: 3.042 },
      { iteration: 2, merit: 5.472e-3 },
    ]);
  });

  it("counts the residual two adjacent rows share exactly once", () => {
    // Row k's nextMerit is row k+1's merit; n rows must give n+1 points.
    const rows = [row(0, 1, 1e-2), row(1, 1e-2, 1e-4), row(2, 1e-4, 1e-8)];

    expect(traceMeritPoints(rows)).toHaveLength(rows.length + 1);
  });

  it("has nothing to plot before the first row arrives", () => {
    expect(traceMeritPoints([])).toEqual([]);
  });

  it("keeps the solve's own iteration numbering", () => {
    expect(traceMeritPoints([row(7, 1e-3, 1e-6)]).map((p) => p.iteration)).toEqual([7, 8]);
  });
});

describe("traceSlopeRatio (P5.19's criterion, as the panel reports it)", () => {
  it("reports ~2 for the quadratic tail of a real drag-free solve", () => {
    // The residuals newtonShooting actually produces from theta 0.45, v0 60
    // against a closed-form target -- see newton-convergence-order.test.ts,
    // which asserts the same number straight off the solver.
    const rows = [row(0, 66.16, 3.042), row(1, 3.042, 5.472e-3), row(2, 5.472e-3, 1.782e-8)];

    expect(traceSlopeRatio(rows)!).toBeCloseTo(2, 2);
  });

  it("has no ratio to report from a single step", () => {
    expect(traceSlopeRatio([row(0, 1, 1e-3)])).toBeUndefined();
    expect(traceSlopeRatio([])).toBeUndefined();
  });
});

describe("formatSlopeRatio", () => {
  it("says what is missing rather than printing a number it does not have", () => {
    expect(formatSlopeRatio(undefined)).toBe("slope ratio: needs 3 residuals");
  });

  it("prints the ratio next to the value that would mean quadratic", () => {
    expect(formatSlopeRatio(1.999)).toBe("slope ratio (last 3): 2.00 — 2.00 is quadratic");
  });

  it("reports a floor-limited tail as the number it is, without a verdict", () => {
    // A healthy solve pushed past the integrator's accuracy reports ~0.89.
    // Calling that "not quadratic" in the UI would be wrong about the solver.
    expect(formatSlopeRatio(0.8919)).toBe("slope ratio (last 3): 0.89 — 2.00 is quadratic");
  });
});
