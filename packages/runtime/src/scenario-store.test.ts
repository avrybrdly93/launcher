import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { createScenarioStore } from "./scenario-store.js";

const [scenarioA, scenarioB] = PRESET_SCENARIOS;
if (!scenarioA || !scenarioB) throw new Error("expected at least 2 preset scenarios for this test");

describe("scenarioStore", () => {
  it("starts with draft === committed === the initial spec", () => {
    const { getState } = createScenarioStore(scenarioA, PRESET_SCENARIOS);
    const state = getState();
    expect(state.draft).toBe(scenarioA);
    expect(state.committed).toBe(scenarioA);
    expect(state.presets).toEqual(PRESET_SCENARIOS);
  });

  it("setDraft replaces only the draft, leaving committed and the previous snapshot untouched", () => {
    const { getState, setDraft } = createScenarioStore(scenarioA);
    const before = getState();

    setDraft(scenarioB);
    const after = getState();

    expect(after.draft).toBe(scenarioB);
    expect(after.committed).toBe(scenarioA);
    // the snapshot object handed out before the mutation is untouched (immutability)
    expect(before.draft).toBe(scenarioA);
    expect(before.committed).toBe(scenarioA);
    expect(after).not.toBe(before);
  });

  it("commit atomically replaces both draft and committed", () => {
    const { getState, commit } = createScenarioStore(scenarioA);
    commit(scenarioB);
    const state = getState();
    expect(state.draft).toBe(scenarioB);
    expect(state.committed).toBe(scenarioB);
  });

  it("every published snapshot (and its presets array) is frozen", () => {
    const { getState, setDraft, commit, setPresets } = createScenarioStore(
      scenarioA,
      PRESET_SCENARIOS,
    );
    expect(Object.isFrozen(getState())).toBe(true);
    expect(Object.isFrozen(getState().presets)).toBe(true);

    setDraft(scenarioB);
    expect(Object.isFrozen(getState())).toBe(true);

    commit(scenarioB);
    expect(Object.isFrozen(getState())).toBe(true);

    setPresets([scenarioA]);
    expect(Object.isFrozen(getState().presets)).toBe(true);
    expect(getState().presets).toEqual([scenarioA]);
  });

  it("mutating a returned snapshot throws in strict mode rather than silently corrupting store state", () => {
    const { getState } = createScenarioStore(scenarioA);
    const state = getState();
    expect(() => {
      // @ts-expect-error -- intentionally violating readonly to prove runtime immutability
      state.draft = scenarioB;
    }).toThrow(TypeError);
  });
});
