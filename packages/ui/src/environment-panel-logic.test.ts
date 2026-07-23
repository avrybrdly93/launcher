import { describe, expect, it } from "vitest";
import { G_STD, ISA, type AtmosphereSpec, type WindSpec } from "@ballista/engine";
import {
  CUSTOM_GRAVITY_ID,
  findGravityPreset,
  GRAVITY_PRESETS,
  gravityPanelValues,
  gravityPresetSelection,
  isAtmosphereKind,
  isWindKind,
  toAtmosphereSpec,
  toWindSpec,
  windPanelValues,
  windParamsSchemaFor,
} from "./environment-panel-logic.js";

describe("gravity presets", () => {
  it("finds every preset by its own g0", () => {
    for (const preset of GRAVITY_PRESETS) {
      expect(findGravityPreset(preset.g0)).toEqual(preset);
    }
  });

  it("returns undefined (-> Custom) for a g0 that matches no preset", () => {
    expect(findGravityPreset(5)).toBeUndefined();
    expect(gravityPresetSelection(5)).toBe(CUSTOM_GRAVITY_ID);
  });

  it("Earth's preset is standard gravity, matching the engine's own default", () => {
    const earth = GRAVITY_PRESETS.find((p) => p.id === "earth")!;
    expect(earth.g0).toBe(G_STD);
  });

  it("gravityPanelValues defaults an unset g0/altitudeDependent to the engine's own defaults", () => {
    expect(gravityPanelValues({})).toEqual({ g0: G_STD, altitudeDependent: false });
  });

  it("gravityPanelValues passes through explicit values unchanged", () => {
    expect(gravityPanelValues({ g0: 1.62, altitudeDependent: true })).toEqual({
      g0: 1.62,
      altitudeDependent: true,
    });
  });
});

describe("isAtmosphereKind / isWindKind", () => {
  it("accepts every real kind and rejects an unknown string", () => {
    expect(isAtmosphereKind("constant")).toBe(true);
    expect(isAtmosphereKind("exponential")).toBe(true);
    expect(isAtmosphereKind("not-a-kind")).toBe(false);

    expect(isWindKind("zero")).toBe(true);
    expect(isWindKind("gaussian-vortex")).toBe(true);
    expect(isWindKind("not-a-kind")).toBe(false);
  });
});

describe("toAtmosphereSpec", () => {
  it("is a no-op when already the requested kind", () => {
    const current: AtmosphereSpec = { kind: "constant" };
    expect(toAtmosphereSpec("constant", current)).toBe(current);
  });

  it("switching to exponential seeds ISA defaults", () => {
    const next = toAtmosphereSpec("exponential", { kind: "constant" });
    expect(next).toEqual({
      kind: "exponential",
      rho0: ISA.rho0,
      T0: ISA.T0,
      p0: ISA.p0,
      scaleHeight: ISA.scaleHeight,
    });
  });

  it("switching back to constant drops the exponential params", () => {
    const next = toAtmosphereSpec("constant", {
      kind: "exponential",
      rho0: 0.5,
      T0: 200,
      p0: 50000,
      scaleHeight: 5000,
    });
    expect(next).toEqual({ kind: "constant" });
  });
});

describe("windParamsSchemaFor / windPanelValues", () => {
  it("zero and gridded have no editable schema/values", () => {
    expect(windParamsSchemaFor("zero")).toBeUndefined();
    expect(windParamsSchemaFor("gridded")).toBeUndefined();
    expect(windPanelValues({ kind: "zero" })).toBeUndefined();
    expect(
      windPanelValues({
        kind: "gridded",
        grid: { x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 2, wx: [0, 0, 0, 0], wy: [0, 0, 0, 0] },
      }),
    ).toBeUndefined();
  });

  it("uniform/log-profile/sinusoidal-gust/gaussian-vortex each have an editable schema with matching values", () => {
    expect(windParamsSchemaFor("uniform")).toBeDefined();
    expect(windPanelValues({ kind: "uniform", wx: 5, wy: 1 })).toEqual({ wx: 5, wy: 1 });
    expect(windPanelValues({ kind: "uniform", wx: 5 })).toEqual({ wx: 5, wy: 0 });

    expect(windParamsSchemaFor("log-profile")).toBeDefined();
    expect(windPanelValues({ kind: "log-profile", frictionVelocity: 0.4 })).toEqual({
      frictionVelocity: 0.4,
      roughnessLength: 0.01,
      wy: 0,
    });

    expect(windParamsSchemaFor("sinusoidal-gust")).toBeDefined();
    expect(
      windPanelValues({ kind: "sinusoidal-gust", mean: 5, amplitude: 2, angularFrequency: 1 }),
    ).toEqual({ mean: 5, amplitude: 2, angularFrequency: 1, phase: 0, wy: 0 });

    expect(windParamsSchemaFor("gaussian-vortex")).toBeDefined();
    expect(windPanelValues({ kind: "gaussian-vortex", circulation: 50, coreRadius: 5 })).toEqual({
      circulation: 50,
      coreRadius: 5,
      centerX: 0,
      centerY: 0,
    });
  });
});

describe("toWindSpec: wind model swap regenerates its param controls (P3.21 validation criterion)", () => {
  it("is a no-op when already the requested kind", () => {
    const current: WindSpec = { kind: "uniform", wx: 5, wy: 1 };
    expect(toWindSpec("uniform", current)).toBe(current);
  });

  it("switching zero -> uniform seeds a fresh uniform spec (different params schema/values than zero's none)", () => {
    const next = toWindSpec("uniform", { kind: "zero" });
    expect(next).toEqual({ kind: "uniform", wx: 5, wy: 0 });
    expect(windParamsSchemaFor(next.kind)).toBeDefined();
  });

  it("switching uniform -> log-profile carries over wy but drops wx, seeding log-profile's own fields", () => {
    const next = toWindSpec("log-profile", { kind: "uniform", wx: 30, wy: 2 });
    expect(next).toEqual({
      kind: "log-profile",
      frictionVelocity: 0.4,
      roughnessLength: 0.01,
      wy: 2,
    });
    expect(windPanelValues(next)).not.toHaveProperty("wx");
  });

  it("switching to gaussian-vortex (no wy) does not carry over a stale wy field", () => {
    const next = toWindSpec("gaussian-vortex", {
      kind: "sinusoidal-gust",
      mean: 1,
      amplitude: 1,
      angularFrequency: 1,
      wy: 3,
    });
    expect(next).toEqual({
      kind: "gaussian-vortex",
      circulation: 50,
      coreRadius: 5,
      centerX: 0,
      centerY: 0,
    });
  });

  it("switching to gridded seeds a minimal valid grid, still a legitimate WindSpec", () => {
    const next = toWindSpec("gridded", { kind: "zero" });
    expect(next.kind).toBe("gridded");
    expect(windParamsSchemaFor(next.kind)).toBeUndefined();
  });

  it("switching gaussian-vortex -> zero drops every param", () => {
    expect(toWindSpec("zero", { kind: "gaussian-vortex", circulation: 1, coreRadius: 1 })).toEqual({
      kind: "zero",
    });
  });
});
