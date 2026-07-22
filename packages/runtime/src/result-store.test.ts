import { describe, expect, it } from "vitest";
import type { SolveStats, Trajectory } from "@ballista/solverkit";
import { createResultStore } from "./result-store.js";

const trajectoryA: Trajectory = Object.freeze({
  nSteps: 2,
  t: new Float64Array([0, 1]),
  channels: Object.freeze([new Float64Array([0, 1]), new Float64Array([0, 2])]),
});

const statsA: SolveStats = Object.freeze({
  nSteps: 2,
  nRHS: 4,
  nRejected: 0,
  hMin: 0.5,
  hMax: 0.5,
  histogramBinEdges: Object.freeze([]),
  histogramCounts: Object.freeze([]),
});

describe("resultStore", () => {
  it("starts empty", () => {
    const { getState } = createResultStore();
    const state = getState();
    expect(state.trajectory).toBeNull();
    expect(state.stats).toBeNull();
    expect(state.events).toEqual([]);
  });

  it("publish atomically replaces trajectory, stats, and events together", () => {
    const { getState, publish } = createResultStore();
    publish(trajectoryA, statsA);
    const state = getState();
    expect(state.trajectory).toBe(trajectoryA);
    expect(state.stats).toBe(statsA);
    expect(state.events).toEqual([]);
  });

  it("publish never mixes fields from two different solves: the pre-publish snapshot is untouched", () => {
    const { getState, publish } = createResultStore();
    publish(trajectoryA, statsA);
    const before = getState();

    const trajectoryB: Trajectory = Object.freeze({
      nSteps: 1,
      t: new Float64Array([0]),
      channels: Object.freeze([new Float64Array([0])]),
    });
    publish(trajectoryB, statsA);

    expect(before.trajectory).toBe(trajectoryA);
    expect(getState().trajectory).toBe(trajectoryB);
  });

  it("clear resets to the empty state", () => {
    const { getState, publish, clear } = createResultStore();
    publish(trajectoryA, statsA);
    clear();
    expect(getState().trajectory).toBeNull();
    expect(getState().stats).toBeNull();
  });

  it("every published snapshot (and its events array) is frozen", () => {
    const { getState, publish } = createResultStore();
    expect(Object.isFrozen(getState())).toBe(true);
    expect(Object.isFrozen(getState().events)).toBe(true);

    publish(trajectoryA, statsA);
    expect(Object.isFrozen(getState())).toBe(true);
    expect(Object.isFrozen(getState().events)).toBe(true);

    const state = getState();
    expect(() => {
      // @ts-expect-error -- intentionally violating readonly to prove runtime immutability
      state.trajectory = null;
    }).toThrow(TypeError);
  });
});
