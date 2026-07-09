import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { loadProjectileSpec } from "./projectile-loader.js";
import { SchemaValidationError } from "./schema.js";
import { TabulatedReynoldsCd } from "./drag-coefficient.js";

describe("loadProjectileSpec", () => {
  it("loads every shipped asset into matching ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = loadProjectileSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 15);
      if (asset.dragModel.kind === "constant") {
        expect(params.dragCoefficient.cd(0, 0)).toBe(asset.dragModel.cd);
      }
      if (asset.liftModel) {
        expect(params.liftCoefficient).toBeDefined();
      } else {
        expect(params.liftCoefficient).toBeUndefined();
      }
    }
  });

  it("resolves a tabulated-reynolds dragModel to a TabulatedReynoldsCd instance", () => {
    const params = loadProjectileSpec({
      id: "test-tabulated",
      name: "Test tabulated sphere",
      mass: 1,
      radius: 0.05,
      dragModel: { kind: "tabulated-reynolds" },
      provenance: "test fixture",
    });
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
  });

  it("rejects a corrupt fixture (negative mass, missing provenance) with a useful error", () => {
    const corrupt = {
      id: "corrupt",
      name: "Corrupt fixture",
      mass: -5,
      radius: 0.05,
      dragModel: { kind: "constant", cd: 0.47 },
    };

    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileSpec(corrupt);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      const err = e as SchemaValidationError;
      expect(err.message).toContain("mass");
      expect(err.message).toContain("provenance");
      expect(err.issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects an unrecognized dragModel kind", () => {
    const corrupt = {
      id: "corrupt-drag",
      name: "Corrupt drag model",
      mass: 1,
      radius: 0.05,
      dragModel: { kind: "made-up-model" },
      provenance: "test fixture",
    };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
  });
});
