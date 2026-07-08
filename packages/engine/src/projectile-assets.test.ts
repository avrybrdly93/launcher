import { describe, expect, it } from "vitest";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  projectileParamsFromSpec,
} from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("includes all seven required assets", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(ids).toEqual([
      "smooth-sphere",
      "golf-ball",
      "soccer-ball",
      "baseball",
      "table-tennis-ball",
      "cannonball",
      "shot-put",
    ]);
  });

  it("every asset validates against ProjectileSpecSchema and has a non-empty provenance", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const parsed = ProjectileSpecSchema.parse(asset);
      expect(parsed.provenance.length).toBeGreaterThan(0);
      expect(parsed.mass).toBeGreaterThan(0);
      expect(parsed.radius).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt asset (negative mass) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    const result = ProjectileSpecSchema.safeParse(corrupt);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("mass"))).toBe(true);
    }
  });

  it("rejects an asset missing provenance", () => {
    const rest: Record<string, unknown> = { ...PROJECTILE_ASSETS[1]! };
    delete rest["provenance"];
    const result = ProjectileSpecSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("projectileParamsFromSpec derives sensible area/volume for each asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = projectileParamsFromSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });
});
