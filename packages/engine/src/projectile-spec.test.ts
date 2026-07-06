import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS, ProjectileSpecSchema } from "./projectile-spec.js";

describe("ProjectileSpec assets", () => {
  it("every built-in asset validates against the schema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("covers the required set: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "smooth-sphere",
        "golf-ball",
        "soccer-ball",
        "baseball",
        "table-tennis-ball",
        "cannonball",
        "shot-put",
      ]),
    );
  });

  it("rejects a corrupt asset (negative mass)", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0], mass: -1 };
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
  });

  it("rejects an asset missing provenance", () => {
    const corrupt: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete corrupt["provenance"];
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
  });
});
