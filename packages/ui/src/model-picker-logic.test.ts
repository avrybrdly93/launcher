import { describe, expect, it } from "vitest";
import {
  PLANAR_CHANNELS,
  PLANAR_SPIN_CHANNELS,
  SPATIAL_CHANNELS,
  type InitialConditions,
  type ModelSpec,
} from "@ballista/engine";
import { DEFAULT_TAU_OMEGA } from "@ballista/runtime";
import {
  applyModelKind,
  channelsForModelKind,
  isModelKind,
  MODEL_KIND_OPTIONS,
  modelKindOf,
  modelPanelValues,
  modelParamsSchemaFor,
} from "./model-picker-logic.js";

const BASE_MODEL: ModelSpec = { id: "planar-projectile", forceIds: ["gravity"] };
const BASE_IC: InitialConditions = { x0: 0, y0: 1, vx0: 10, vy0: 10 };

describe("MODEL_KIND_OPTIONS / isModelKind", () => {
  it("lists exactly the three P4.30-registered kinds", () => {
    expect(MODEL_KIND_OPTIONS.map((o) => o.id)).toEqual(["planar", "planar-spin", "spatial"]);
  });

  it("accepts every real kind and rejects an unknown string", () => {
    expect(isModelKind("planar")).toBe(true);
    expect(isModelKind("planar-spin")).toBe(true);
    expect(isModelKind("spatial")).toBe(true);
    expect(isModelKind("pendulum")).toBe(false);
    expect(isModelKind("")).toBe(false);
  });
});

describe("modelKindOf", () => {
  it("defaults to 'planar' when kind is omitted (every pre-P4.30 ModelSpec)", () => {
    expect(modelKindOf(BASE_MODEL)).toBe("planar");
  });

  it("returns the explicit kind when set", () => {
    expect(modelKindOf({ ...BASE_MODEL, kind: "spatial" })).toBe("spatial");
  });
});

describe("channelsForModelKind: switching model regenerates channels (P4.30 validation criterion)", () => {
  it("returns each model's own exported channel-meta constant, by reference", () => {
    expect(channelsForModelKind("planar")).toBe(PLANAR_CHANNELS);
    expect(channelsForModelKind("planar-spin")).toBe(PLANAR_SPIN_CHANNELS);
    expect(channelsForModelKind("spatial")).toBe(SPATIAL_CHANNELS);
  });

  it("the three kinds' channel lists are all different from one another", () => {
    const planar = channelsForModelKind("planar").map((c) => c.name);
    const spin = channelsForModelKind("planar-spin").map((c) => c.name);
    const spatial = channelsForModelKind("spatial").map((c) => c.name);
    expect(planar).toEqual(["x", "y", "vx", "vy"]);
    expect(spin).toEqual(["x", "y", "vx", "vy", "omega"]);
    expect(spatial).toEqual(["x", "y", "z", "vx", "vy", "vz"]);
  });
});

describe("modelParamsSchemaFor / modelPanelValues", () => {
  it("'planar' has no editable schema/values", () => {
    expect(modelParamsSchemaFor("planar")).toBeUndefined();
    expect(modelPanelValues("planar", BASE_MODEL, BASE_IC)).toBeUndefined();
  });

  it("'planar-spin' has a tauOmega schema, defaulting to DEFAULT_TAU_OMEGA when unset", () => {
    expect(modelParamsSchemaFor("planar-spin")).toBeDefined();
    expect(modelPanelValues("planar-spin", BASE_MODEL, BASE_IC)).toEqual({
      tauOmega: DEFAULT_TAU_OMEGA,
    });
    expect(modelPanelValues("planar-spin", { ...BASE_MODEL, tauOmega: 12 }, BASE_IC)).toEqual({
      tauOmega: 12,
    });
  });

  it("'spatial' has a z0/vz0 schema, defaulting both to 0 when unset", () => {
    expect(modelParamsSchemaFor("spatial")).toBeDefined();
    expect(modelPanelValues("spatial", BASE_MODEL, BASE_IC)).toEqual({ z0: 0, vz0: 0 });
    expect(modelPanelValues("spatial", BASE_MODEL, { ...BASE_IC, z0: 5, vz0: -3 })).toEqual({
      z0: 5,
      vz0: -3,
    });
  });
});

describe("applyModelKind: switching model regenerates channels/controls (P4.30 validation criterion)", () => {
  it("is a no-op when already the requested kind", () => {
    const spinModel: ModelSpec = { ...BASE_MODEL, kind: "planar-spin", tauOmega: 12 };
    const result = applyModelKind("planar-spin", spinModel, BASE_IC);
    expect(result.model).toBe(spinModel);
    expect(result.initialConditions).toBe(BASE_IC);
  });

  it("switching planar -> planar-spin seeds tauOmega=DEFAULT_TAU_OMEGA, leaving initialConditions untouched", () => {
    const { model, initialConditions } = applyModelKind("planar-spin", BASE_MODEL, BASE_IC);
    expect(model).toEqual({ ...BASE_MODEL, kind: "planar-spin", tauOmega: DEFAULT_TAU_OMEGA });
    expect(initialConditions).toBe(BASE_IC);
  });

  it("switching planar -> spatial seeds z0=vz0=0 on initialConditions, leaving model.tauOmega absent", () => {
    const { model, initialConditions } = applyModelKind("spatial", BASE_MODEL, BASE_IC);
    expect(model).toEqual({ ...BASE_MODEL, kind: "spatial" });
    expect(initialConditions).toEqual({ ...BASE_IC, z0: 0, vz0: 0 });
  });

  it("switching spatial -> planar-spin does not carry over z0/vz0 into a fresh tauOmega read (each kind's own params are independent)", () => {
    const spatialIc: InitialConditions = { ...BASE_IC, z0: 5, vz0: -3 };
    const { model, initialConditions } = applyModelKind(
      "planar-spin",
      { ...BASE_MODEL, kind: "spatial" },
      spatialIc,
    );
    expect(model).toEqual({ ...BASE_MODEL, kind: "planar-spin", tauOmega: DEFAULT_TAU_OMEGA });
    // initialConditions themselves are never rewritten by a non-spatial switch (z0/vz0 stay put, just unused).
    expect(initialConditions).toBe(spatialIc);
  });

  it("switching planar-spin -> planar drops the stale tauOmega field entirely", () => {
    const spinModel: ModelSpec = { ...BASE_MODEL, kind: "planar-spin", tauOmega: 12 };
    const { model } = applyModelKind("planar", spinModel, BASE_IC);
    expect(model).toEqual({ ...BASE_MODEL, kind: "planar" });
    expect("tauOmega" in model).toBe(false);
  });

  it("switching preserves an already-set tauOmega rather than resetting it to the default", () => {
    const { model } = applyModelKind(
      "planar-spin",
      { ...BASE_MODEL, kind: "planar", tauOmega: 40 },
      BASE_IC,
    );
    expect(model.tauOmega).toBe(40);
  });

  it("id/forceIds are always carried over unchanged regardless of kind switch", () => {
    const customModel: ModelSpec = { id: "custom-id", forceIds: ["gravity", "drag-quadratic"] };
    for (const kind of ["planar", "planar-spin", "spatial"] as const) {
      const { model } = applyModelKind(kind, customModel, BASE_IC);
      expect(model.id).toBe("custom-id");
      expect(model.forceIds).toEqual(["gravity", "drag-quadratic"]);
    }
  });
});
