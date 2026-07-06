import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS } from "./projectile-spec.js";
import {
  loadProjectileAsset,
  loadProjectileAssets,
  VALIDATED_PROJECTILE_ASSETS,
} from "./asset-loader.js";

describe("asset loader", () => {
  it("loads every built-in asset without throwing", () => {
    expect(VALIDATED_PROJECTILE_ASSETS.length).toBe(PROJECTILE_ASSETS.length);
  });

  it("round-trips a valid asset unchanged", () => {
    const golf = PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    expect(loadProjectileAsset(golf)).toEqual(golf);
  });

  it("rejects a corrupt fixture (negative radius) with a useful, locatable error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, radius: -0.05 };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.fail("expected loadProjectileAsset to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("radius");
    }
  });

  it("rejects a corrupt fixture missing a required field", () => {
    const corrupt: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete corrupt["mass"];
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
  });

  it("batch loading tags which array entry was corrupt", () => {
    const batch: unknown[] = [PROJECTILE_ASSETS[0], { ...PROJECTILE_ASSETS[1]!, mass: -1 }];
    try {
      loadProjectileAssets(batch);
      expect.fail("expected loadProjectileAssets to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("asset[1]");
    }
  });
});
