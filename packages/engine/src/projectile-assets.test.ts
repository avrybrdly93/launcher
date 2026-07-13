import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships exactly the 7 initial-catalog projectiles (§3.9)", () => {
    expect(PROJECTILE_ASSETS).toHaveLength(7);
    expect(PROJECTILE_ASSETS.map((p) => p.id)).toEqual([
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

  it("every asset has a non-empty top-level provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("every numeric datum (mass, radius, and drag/lift model values) carries its own citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass.citation.length).toBeGreaterThan(0);
      expect(asset.radius.citation.length).toBeGreaterThan(0);
      expect(asset.dragModel.citation.length).toBeGreaterThan(0);
      if (asset.liftModel.kind === "saturating") {
        expect(asset.liftModel.citation.length).toBeGreaterThan(0);
      }
      if (asset.spinDecayTauSeconds) {
        expect(asset.spinDecayTauSeconds.citation.length).toBeGreaterThan(0);
      }
    }
  });

  it("ids are unique", () => {
    const ids = PROJECTILE_ASSETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("physical values are positive and dimensionally sane", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass.value).toBeGreaterThan(0);
      expect(asset.radius.value).toBeGreaterThan(0);
      if (asset.dragModel.kind === "constant") {
        expect(asset.dragModel.cd).toBeGreaterThan(0);
      }
    }
  });
});
