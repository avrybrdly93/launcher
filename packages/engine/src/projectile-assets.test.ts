import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema, createProjectileParamsFromSpec } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers the 7 required projectiles", () => {
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

  it("every asset validates against ProjectileSpecSchema and has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const result = ProjectileSpecSchema.safeParse(asset);
      expect(result.success).toBe(true);
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("every asset materializes into usable ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = createProjectileParamsFromSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt fixture (missing provenance, negative mass)", () => {
    const corrupt = {
      id: "bad",
      name: "Bad Asset",
      mass: -1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
    };
    const result = ProjectileSpecSchema.safeParse(corrupt);
    expect(result.success).toBe(false);
  });
});
