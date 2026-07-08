import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { loadProjectileAsset, loadProjectileAssets } from "./asset-loader.js";

describe("loadProjectileAsset(s)", () => {
  it("loads the full built-in asset bundle without error", () => {
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toHaveLength(PROJECTILE_ASSETS.length);
    expect(loaded.map((a) => a.id)).toEqual(PROJECTILE_ASSETS.map((a) => a.id));
  });

  it("rejects a corrupt fixture (missing provenance) with a useful, actionable error", () => {
    const corrupt = {
      id: "bad",
      name: "Bad ball",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
    };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const e = err as SchemaValidationError;
      expect(e.message).toContain("provenance");
      expect(e.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt fixture inside a bundle, prefixed with its index", () => {
    const corrupt = { ...PROJECTILE_ASSETS[2]!, mass: -5 };
    const bundle = [PROJECTILE_ASSETS[0]!, PROJECTILE_ASSETS[1]!, corrupt];
    try {
      loadProjectileAssets(bundle);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("index 2");
      expect((err as SchemaValidationError).message).toContain("mass");
    }
  });

  it("rejects a wrong-shaped dragCoefficient discriminant", () => {
    const corrupt = { ...PROJECTILE_ASSETS[3]!, dragCoefficient: { kind: "quadratic", value: 1 } };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
  });
});
