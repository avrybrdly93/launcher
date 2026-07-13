import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-spec.js";
import { loadProjectileAsset } from "./projectile-asset-loader.js";
import { SchemaValidationError } from "./schema.js";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";

describe("loadProjectileAsset", () => {
  it("loads every built-in asset into runtime ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const { spec, params } = loadProjectileAsset(asset);
      expect(spec.id).toBe(asset.id);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
    }
  });

  it("builds a ConstantCd for a 'constant' drag spec", () => {
    const { params } = loadProjectileAsset({
      id: "x",
      name: "x",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "constant", cd: 0.42 },
      provenance: "test fixture",
    });
    expect(params.dragCoefficient).toBeInstanceOf(ConstantCd);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.42);
  });

  it("builds a TabulatedReynoldsCd for a 'tabulated-reynolds' drag spec", () => {
    const { params } = loadProjectileAsset({
      id: "x",
      name: "x",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "tabulated-reynolds" },
      provenance: "test fixture",
    });
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
  });

  it("builds a SaturatingLiftCoefficient when a lift spec is present", () => {
    const { params } = loadProjectileAsset({
      id: "x",
      name: "x",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "constant", cd: 0.4 },
      liftCoefficient: { kind: "saturating", maxCl: 0.5, slope: 1.2 },
      spin: 100,
      provenance: "test fixture",
    });
    expect(params.liftCoefficient).toBeInstanceOf(SaturatingLiftCoefficient);
    expect(params.spin).toBe(100);
  });

  it("rejects a corrupt fixture (missing provenance) with a useful, field-annotated error", () => {
    const corrupt = {
      id: "bad",
      name: "bad",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "constant", cd: 0.4 },
      // provenance omitted
    };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("provenance");
    }
  });

  it("rejects a corrupt fixture (negative mass) with a useful, field-annotated error", () => {
    const corrupt = {
      id: "bad",
      name: "bad",
      mass: -5,
      radius: 0.1,
      dragCoefficient: { kind: "constant", cd: 0.4 },
      provenance: "test fixture",
    };
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("mass");
    }
  });

  it("rejects a corrupt fixture (unknown dragCoefficient.kind) with a useful error", () => {
    const corrupt = {
      id: "bad",
      name: "bad",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "quadratic-in-mach", cd: 0.4 },
      provenance: "test fixture",
    };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
  });
});
