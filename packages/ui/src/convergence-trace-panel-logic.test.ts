import { describe, expect, it } from "vitest";
import type { OptimizeIteration, OptimizeJobResult } from "@ballista/runtime";
import {
  formatMerit,
  initialTraceState,
  isRunning,
  summarize,
  toTraceRow,
  traceReducer,
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
