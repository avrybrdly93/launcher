import { describe, expect, it } from "vitest";
import { KNOWN_MODEL_IDS } from "@ballista/runtime";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { MODEL_LABELS, MODEL_OPTIONS, toScenarioSpecForModel } from "./model-picker-logic.js";

describe("MODEL_OPTIONS", () => {
  it("has one entry per KNOWN_MODEL_IDS, in the same order", () => {
    expect(MODEL_OPTIONS.map((o) => o.id)).toEqual(KNOWN_MODEL_IDS);
  });

  it("every known model id has its own (non-fallback) label", () => {
    for (const id of KNOWN_MODEL_IDS) {
      expect(MODEL_LABELS[id]).toBeDefined();
      expect(MODEL_LABELS[id]).not.toBe(id);
    }
  });
});

describe("toScenarioSpecForModel", () => {
  const base = PRESET_SCENARIOS[0]!;

  it("swaps only model.id, keeping forceIds and everything else unchanged", () => {
    const next = toScenarioSpecForModel("planar-projectile-spin", base);
    expect(next.model.id).toBe("planar-projectile-spin");
    expect(next.model.forceIds).toEqual(base.model.forceIds);
    expect(next.projectile).toEqual(base.projectile);
    expect(next.initialConditions).toEqual(base.initialConditions);
    expect(next.environment).toEqual(base.environment);
    expect(next.solver).toEqual(base.solver);
  });

  it("does not mutate the input spec", () => {
    toScenarioSpecForModel("spatial-projectile", base);
    expect(base.model.id).toBe("planar-projectile");
  });
});
