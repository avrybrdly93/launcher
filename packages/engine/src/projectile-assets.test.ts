import { describe, expect, it } from "vitest";
import { projectileSpecSchema } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { createProjectileParams } from "./projectile-spec.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball",
  "shot-put",
];

describe("PROJECTILE_ASSETS", () => {
  it("includes exactly the 7 initial presets (§3.9)", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every asset validates against projectileSpecSchema and has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => projectileSpecSchema.parse(asset)).not.toThrow();
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt asset (negative mass)", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, massKg: -1 };
    expect(() => projectileSpecSchema.parse(corrupt)).toThrow();
  });

  it("rejects an asset missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance["provenance"];
    expect(() => projectileSpecSchema.parse(withoutProvenance)).toThrow();
  });

  it("every asset materializes into usable ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = createProjectileParams(asset);
      expect(params.mass).toBe(asset.massKg);
      expect(params.radius).toBe(asset.radiusM);
      expect(params.area).toBeCloseTo(Math.PI * asset.radiusM * asset.radiusM, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });
});
