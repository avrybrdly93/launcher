import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS, ProjectileSpecSchema } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("has the 7 initial assets from §3.9", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      [
        "baseball",
        "cannonball",
        "golf-ball",
        "shot-put",
        "smooth-sphere",
        "soccer-ball",
        "table-tennis-ball",
      ].sort(),
    );
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(ProjectileSpecSchema, asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(10);
    }
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has physically sane mass and radius for every asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });
});

describe("ProjectileSpecSchema", () => {
  it("rejects a spec missing provenance with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, provenance: undefined };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects non-positive mass", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects an unknown dragModel kind", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, dragModel: { kind: "made-up" } };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });
});
