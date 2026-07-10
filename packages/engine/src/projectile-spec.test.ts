import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import { PROJECTILE_ASSETS, ProjectileSpecSchema } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers the §3.9 asset library: sphere, golf, soccer, baseball, TT, cannonball, shot put", () => {
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

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects a spec with a missing/empty provenance", () => {
    const bad = { ...PROJECTILE_ASSETS[0]!, provenance: "" };
    expect(() => parseWithSchema(ProjectileSpecSchema, bad)).toThrow();
  });

  it("rejects a spec with non-positive mass or radius", () => {
    const badMass = { ...PROJECTILE_ASSETS[0]!, mass: 0 };
    const badRadius = { ...PROJECTILE_ASSETS[0]!, radius: -1 };
    expect(() => parseWithSchema(ProjectileSpecSchema, badMass)).toThrow();
    expect(() => parseWithSchema(ProjectileSpecSchema, badRadius)).toThrow();
  });

  it("rejects an unknown dragModel kind", () => {
    const bad = { ...PROJECTILE_ASSETS[0]!, dragModel: { kind: "quadratic-magic" } };
    expect(() => parseWithSchema(ProjectileSpecSchema, bad)).toThrow();
  });
});
