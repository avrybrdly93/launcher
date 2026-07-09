import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships the seven §3.9 initial projectiles", () => {
    expect(PROJECTILE_ASSETS.map((p) => p.id).sort()).toEqual(
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

  it("every asset has a non-trivial provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(20);
    }
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all masses and radii are positive and physically plausible", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.mass).toBeLessThan(20); // heaviest asset (shot put) is 7.26 kg
      expect(asset.radius).toBeGreaterThan(0);
      expect(asset.radius).toBeLessThan(1);
    }
  });
});
