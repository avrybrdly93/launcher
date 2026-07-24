import { describe, expect, it } from "vitest";
import type { Trajectory } from "@ballista/solverkit";
import { COMPARE_PALETTE, compareLegend, createCompareStore } from "./compare-store.js";

function fakeTrajectory(nSteps: number): Trajectory {
  return {
    nSteps,
    t: new Float64Array(nSteps),
    channels: [new Float64Array(nSteps), new Float64Array(nSteps)],
  };
}

describe("createCompareStore: pinned list + color assignment", () => {
  it("starts empty", () => {
    const store = createCompareStore();
    expect(store.getState().pinned).toEqual([]);
  });

  it("pin() appends an entry with the next unused palette color, defaulting label to stepperId", () => {
    const store = createCompareStore();
    const a = store.pin(fakeTrajectory(3), "explicit-euler");
    const b = store.pin(fakeTrajectory(5), "classical-rk4", "RK4 (h=0.01)");

    expect(store.getState().pinned.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(a.color).toBe(COMPARE_PALETTE[0]);
    expect(b.color).toBe(COMPARE_PALETTE[1]);
    expect(a.label).toBe("explicit-euler");
    expect(b.label).toBe("RK4 (h=0.01)");
    expect(a.color).not.toBe(b.color);
  });

  it("unpin() removes the entry and frees its slot for reuse by a later pin, never colliding with a still-pinned entry", () => {
    const store = createCompareStore();
    const a = store.pin(fakeTrajectory(1), "explicit-euler"); // slot 0
    const b = store.pin(fakeTrajectory(1), "classical-rk4"); // slot 1
    store.unpin(a.id);
    expect(store.getState().pinned.map((p) => p.id)).toEqual([b.id]);

    const c = store.pin(fakeTrajectory(1), "heun-rk2"); // reuses freed slot 0
    expect(c.color).toBe(COMPARE_PALETTE[0]);
    expect(c.color).not.toBe(b.color);
  });

  it("unpin() on an unknown id is a no-op", () => {
    const store = createCompareStore();
    store.pin(fakeTrajectory(1), "explicit-euler");
    expect(() => store.unpin("no-such-id")).not.toThrow();
    expect(store.getState().pinned).toHaveLength(1);
  });

  it("clear() removes every entry and frees every slot", () => {
    const store = createCompareStore();
    store.pin(fakeTrajectory(1), "explicit-euler");
    store.pin(fakeTrajectory(1), "classical-rk4");
    store.clear();
    expect(store.getState().pinned).toEqual([]);

    const fresh = store.pin(fakeTrajectory(1), "midpoint-rk2");
    expect(fresh.color).toBe(COMPARE_PALETTE[0]);
  });

  it("throws once every palette slot is in use, without mutating state", () => {
    const store = createCompareStore();
    for (let i = 0; i < COMPARE_PALETTE.length; i++) {
      store.pin(fakeTrajectory(1), `stepper-${i}`);
    }
    expect(store.getState().pinned).toHaveLength(COMPARE_PALETTE.length);

    expect(() => store.pin(fakeTrajectory(1), "one-too-many")).toThrow(/palette exhausted/i);
    expect(store.getState().pinned).toHaveLength(COMPARE_PALETTE.length);
  });

  it("published state is frozen (immutable after publish, mirroring resultStore)", () => {
    const store = createCompareStore();
    store.pin(fakeTrajectory(1), "explicit-euler");
    const state = store.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.pinned)).toBe(true);
    expect(Object.isFrozen(state.pinned[0])).toBe(true);
  });
});

describe("compareLegend", () => {
  it("derives one legend row per pinned entry, in pin order", () => {
    const store = createCompareStore();
    const a = store.pin(fakeTrajectory(1), "explicit-euler");
    const b = store.pin(fakeTrajectory(1), "classical-rk4", "RK4");

    expect(compareLegend(store.getState())).toEqual([
      { id: a.id, label: "explicit-euler", color: a.color },
      { id: b.id, label: "RK4", color: b.color },
    ]);
  });

  it("is empty for an empty store", () => {
    expect(compareLegend(createCompareStore().getState())).toEqual([]);
  });
});
