import { describe, expect, it } from "vitest";
import {
  hydrateProjectileSpec,
  loadProjectileAssets,
  loadProjectileSpec,
  VALIDATED_PROJECTILE_ASSETS,
} from "./asset-loader.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";

describe("loadProjectileSpec", () => {
  it("loads a well-formed fixture", () => {
    const spec = loadProjectileSpec(PROJECTILE_ASSETS["baseball"]);
    expect(spec).toEqual(PROJECTILE_ASSETS["baseball"]);
  });

  it("rejects a corrupt fixture (missing field, wrong type, bad discriminant) with a useful error", () => {
    const corrupt = {
      id: "corrupt",
      name: "Corrupt fixture",
      mass: "not a number", // wrong type
      // radius missing entirely
      dragModel: { type: "not-a-real-model" }, // bad discriminant
      liftModel: { type: "none" },
      provenance: "", // empty, also invalid
    };

    let thrown: unknown;
    try {
      loadProjectileSpec(corrupt);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SchemaValidationError);
    const err = thrown as SchemaValidationError;
    expect(err.issues.length).toBeGreaterThanOrEqual(4);
    expect(err.message).toMatch(/mass/);
    expect(err.message).toMatch(/radius/);
    expect(err.message).toMatch(/dragModel/);
    expect(err.message).toMatch(/provenance/);
  });
});

describe("loadProjectileAssets / VALIDATED_PROJECTILE_ASSETS", () => {
  it("validates every shipped asset without throwing", () => {
    expect(() => loadProjectileAssets()).not.toThrow();
  });

  it("VALIDATED_PROJECTILE_ASSETS was validated eagerly at module load and matches the raw assets", () => {
    expect(VALIDATED_PROJECTILE_ASSETS).toEqual(PROJECTILE_ASSETS);
  });
});

describe("hydrateProjectileSpec", () => {
  it("hydrates a constant-drag, no-lift spec into working ProjectileParams", () => {
    const spec = PROJECTILE_ASSETS["shotPut"]!;
    const params = hydrateProjectileSpec(spec);
    expect(params.mass).toBe(spec.mass);
    expect(params.radius).toBe(spec.radius);
    expect(params.dragCoefficient).toBeInstanceOf(ConstantCd);
    expect(spec.dragModel.type).toBe("constant");
    expect(params.dragCoefficient.cd(1e5, 0)).toBe(
      spec.dragModel.type === "constant" ? spec.dragModel.cd : NaN,
    );
    expect(params.liftCoefficient).toBeUndefined();
  });

  it("hydrates a tabulated-reynolds drag, saturating-lift spec, with an explicit spin", () => {
    const spec = PROJECTILE_ASSETS["tableTennisBall"]!;
    const params = hydrateProjectileSpec(spec, 250);
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
    expect(params.liftCoefficient).toBeInstanceOf(SaturatingLiftCoefficient);
    expect(params.spin).toBe(250);
  });

  it("hydrates smoothSphere's tabulated Cd to match the underlying table at a knot", () => {
    const spec = PROJECTILE_ASSETS["smoothSphere"]!;
    const params = hydrateProjectileSpec(spec);
    expect(params.dragCoefficient.cd(1e3, 0)).toBeCloseTo(0.47, 6);
  });
});
