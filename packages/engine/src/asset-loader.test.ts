import { describe, expect, it } from "vitest";
import { loadProjectileAssets } from "./asset-loader.js";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

const VALID_FIXTURE = {
  id: "test-ball",
  name: "Test ball",
  mass: 0.145,
  radius: 0.0366,
  dragModel: { kind: "constant", cd: 0.47 },
  provenance: "unit test fixture",
};

describe("loadProjectileAssets", () => {
  it("loads a valid list", () => {
    const specs = loadProjectileAssets([VALID_FIXTURE]);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.id).toBe("test-ball");
  });

  it("rejects a non-array input with a useful error", () => {
    expect(() => loadProjectileAssets({ not: "an array" })).toThrow(SchemaValidationError);
    expect(() => loadProjectileAssets({ not: "an array" })).toThrow(/must be an array/);
  });

  it("rejects a corrupt fixture (negative mass) with an error naming the index, id, and field", () => {
    const corrupt = { ...VALID_FIXTURE, mass: -5 };
    expect(() => loadProjectileAssets([VALID_FIXTURE, corrupt])).toThrow(SchemaValidationError);

    let caught: unknown;
    try {
      loadProjectileAssets([VALID_FIXTURE, corrupt]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SchemaValidationError);
    const message = (caught as SchemaValidationError).message;
    expect(message).toContain("index 1");
    expect(message).toContain("test-ball");
    expect(message).toContain("mass");
  });

  it("rejects a fixture with an unrecognized drag-model kind", () => {
    const corrupt = { ...VALID_FIXTURE, dragModel: { kind: "unknown-model" } };
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects a fixture missing provenance", () => {
    const corrupt: Record<string, unknown> = { ...VALID_FIXTURE };
    delete corrupt.provenance;
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects duplicate ids across the list", () => {
    expect(() => loadProjectileAssets([VALID_FIXTURE, { ...VALID_FIXTURE }])).toThrow(
      /Duplicate projectile asset id/,
    );
  });

  it("the real PROJECTILE_ASSETS export already passed through the loader at import time", () => {
    expect(PROJECTILE_ASSETS.length).toBeGreaterThan(0);
    expect(() => loadProjectileAssets(PROJECTILE_ASSETS)).not.toThrow();
  });
});
