import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS } from "./projectile-spec.js";
import { loadProjectileAsset, projectileParamsFromSpec } from "./asset-loader.js";

describe("loadProjectileAsset", () => {
  it("builds working ProjectileParams for every shipped asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = loadProjectileAsset(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e5, 0)).toBeGreaterThan(0);
    }
  });

  it("uses TabulatedReynoldsCd for a 'tabulated-re' dragModel (Cd varies with Re)", () => {
    const smoothSphere = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;
    const params = projectileParamsFromSpec(smoothSphere);
    const cdLowRe = params.dragCoefficient.cd(1e2, 0);
    const cdHighRe = params.dragCoefficient.cd(4e5, 0);
    expect(cdHighRe).toBeLessThan(cdLowRe); // drag crisis
  });

  it("uses a fixed value for a 'constant' dragModel", () => {
    const golf = PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    const params = projectileParamsFromSpec(golf);
    expect(params.dragCoefficient.cd(1e2, 0)).toBe(0.25);
    expect(params.dragCoefficient.cd(1e6, 0)).toBe(0.25);
  });

  it("rejects a corrupt fixture (missing provenance) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, provenance: "" };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("provenance");
    }
  });

  it("rejects a corrupt fixture (negative radius) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, radius: -0.05 };
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("radius");
    }
  });
});
