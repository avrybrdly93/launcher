import { describe, expect, it } from "vitest";
import { loadProjectileAsset, loadProjectileAssets } from "./projectile-asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";

describe("loadProjectileAsset / loadProjectileAssets (P1.26)", () => {
  it("loads every built-in asset without throwing", () => {
    expect(() => loadProjectileAssets(PROJECTILE_ASSETS)).not.toThrow();
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toHaveLength(PROJECTILE_ASSETS.length);
    expect(loaded.map((a) => a.id)).toEqual(PROJECTILE_ASSETS.map((a) => a.id));
  });

  it("rejects a corrupt fixture (negative mass) with a useful, field-specific error", () => {
    const corrupt = {
      id: "corrupt-negative-mass",
      displayName: "Corrupt",
      mass: -1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "fixture",
    };

    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const validationError = err as SchemaValidationError;
      expect(validationError.message).toContain("mass");
      expect(validationError.issues.some((i) => i.path.join(".") === "mass")).toBe(true);
    }
  });

  it("rejects a corrupt fixture (missing provenance) with a useful, field-specific error", () => {
    const corrupt = {
      id: "corrupt-no-provenance",
      displayName: "Corrupt",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
    };

    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const validationError = err as SchemaValidationError;
      expect(validationError.message).toContain("provenance");
    }
  });

  it("rejects a corrupt fixture (unknown dragCoefficient.kind) with a useful, field-specific error", () => {
    const corrupt = {
      id: "corrupt-drag-kind",
      displayName: "Corrupt",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "magic", value: 0.47 },
      provenance: "fixture",
    };

    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const validationError = err as SchemaValidationError;
      expect(validationError.message).toContain("dragCoefficient");
    }
  });

  it("fails loadProjectileAssets on the first invalid entry in a batch", () => {
    const batch = [
      PROJECTILE_ASSETS[0],
      {
        id: "bad",
        displayName: "Bad",
        mass: 0,
        radius: 0.05,
        dragCoefficient: { kind: "constant", value: 1 },
      },
    ];

    expect(() => loadProjectileAssets(batch)).toThrow(SchemaValidationError);
  });
});
