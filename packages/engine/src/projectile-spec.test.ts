import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { parseProjectileSpec, ProjectileSpecSchema, PROJECTILE_ASSETS } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  const expectedIds = [
    "sphere",
    "golf",
    "soccer",
    "baseball",
    "tableTennis",
    "cannonball",
    "shotPut",
  ];

  it("has exactly the sphere/golf/soccer/baseball/TT/cannonball/shot-put assets", () => {
    expect(Object.keys(PROJECTILE_ASSETS).sort()).toEqual([...expectedIds].sort());
  });

  it("every asset validates against ProjectileSpecSchema and carries a non-empty provenance string", () => {
    for (const [key, asset] of Object.entries(PROJECTILE_ASSETS)) {
      const parsed = parseProjectileSpec(asset);
      expect(parsed).toEqual(asset);
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(10);
      expect(asset.id).toBe(key);
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("rejects a spec missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS.golf! };
    delete withoutProvenance.provenance;
    expect(() => parseProjectileSpec(withoutProvenance)).toThrow(SchemaValidationError);
  });

  it("rejects a spec with a non-positive mass", () => {
    const invalid = { ...PROJECTILE_ASSETS.baseball!, mass: 0 };
    expect(() => parseProjectileSpec(invalid)).toThrow(SchemaValidationError);
  });

  it("rejects an unknown dragCoefficient descriptor type", () => {
    const invalid = { ...PROJECTILE_ASSETS.sphere!, dragCoefficient: { type: "bogus" } };
    const result = ProjectileSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("spans a wide mass/radius range (low-Pi shot put to high-Pi table tennis, §3.9)", () => {
    expect(PROJECTILE_ASSETS.shotPut!.mass).toBeGreaterThan(
      PROJECTILE_ASSETS.tableTennis!.mass * 1000,
    );
  });
});
