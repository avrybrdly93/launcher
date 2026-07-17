import { describe, expect, it } from "vitest";
import { loadProjectileAssets } from "./asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";

const VALID_SPEC = {
  id: "valid-sphere",
  name: "Valid sphere",
  mass: 1,
  radius: 0.1,
  dragModel: { kind: "constant", cd: 0.47 },
  provenance: "test fixture",
};

describe("loadProjectileAssets", () => {
  it("loads the real asset library without error", () => {
    expect(loadProjectileAssets(PROJECTILE_ASSETS)).toHaveLength(PROJECTILE_ASSETS.length);
  });

  it("accepts a well-formed fixture", () => {
    expect(loadProjectileAssets([VALID_SPEC])).toEqual([VALID_SPEC]);
  });

  it("rejects a fixture missing provenance, naming the offending asset", () => {
    const corrupt = { ...VALID_SPEC, provenance: "" };
    expect(() => loadProjectileAssets([VALID_SPEC, corrupt])).toThrow(SchemaValidationError);
    try {
      loadProjectileAssets([VALID_SPEC, corrupt]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("valid-sphere");
      expect((err as SchemaValidationError).message).toContain("index 1");
      expect((err as SchemaValidationError).message).toContain("provenance");
    }
  });

  it("rejects a fixture with a non-positive mass, naming the field", () => {
    const corrupt = { ...VALID_SPEC, mass: -5 };
    expect(() => loadProjectileAssets([corrupt])).toThrow(/mass/);
  });

  it("rejects an unknown dragModel kind with a useful error", () => {
    const corrupt = { ...VALID_SPEC, dragModel: { kind: "made-up", cd: 0.5 } };
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects duplicate asset ids", () => {
    expect(() => loadProjectileAssets([VALID_SPEC, { ...VALID_SPEC }])).toThrow(
      /Duplicate.*valid-sphere/,
    );
  });

  it("leaves a fully valid list untouched in order", () => {
    const other = { ...VALID_SPEC, id: "other-sphere" };
    expect(loadProjectileAssets([VALID_SPEC, other]).map((s) => s.id)).toEqual([
      "valid-sphere",
      "other-sphere",
    ]);
  });
});
