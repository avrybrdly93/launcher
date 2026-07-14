import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, resolveProjectileSpec } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships all 7 initial assets from §3.9", () => {
    expect(PROJECTILE_ASSETS).toHaveLength(7);
    expect(PROJECTILE_ASSETS.map((a) => a.id)).toEqual([
      "smooth-sphere",
      "golf-ball",
      "soccer-ball",
      "baseball",
      "table-tennis-ball",
      "cannonball",
      "shot-put",
    ]);
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

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every asset resolves to physically sane ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = resolveProjectileSpec(asset);
      expect(params.mass).toBeGreaterThan(0);
      expect(params.radius).toBeGreaterThan(0);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.volume).toBeCloseTo((4 / 3) * Math.PI * asset.radius ** 3, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });

  it("mass values fall within an order of magnitude of their real-world spec (sanity check)", () => {
    const byId = new Map(PROJECTILE_ASSETS.map((a) => [a.id, a]));
    expect(byId.get("golf-ball")?.mass).toBeCloseTo(0.0459, 3);
    expect(byId.get("baseball")?.mass).toBeCloseTo(0.145, 3);
    expect(byId.get("table-tennis-ball")?.mass).toBeCloseTo(0.0027, 4);
    expect(byId.get("shot-put")?.mass).toBeCloseTo(7.26, 2);
  });
});
