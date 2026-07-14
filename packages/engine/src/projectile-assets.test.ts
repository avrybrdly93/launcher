import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("ships the 7 initial data assets from §3.9", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      [
        "smooth-sphere",
        "golf-ball",
        "soccer-ball",
        "baseball",
        "table-tennis-ball",
        "cannonball",
        "shot-put",
      ].sort(),
    );
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const result = ProjectileSpecSchema.safeParse(asset);
      expect(
        result.success,
        `${asset.id}: ${JSON.stringify(result.success ? null : result.error?.issues)}`,
      ).toBe(true);
    }
  });

  it("every asset carries a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(20);
    }
  });

  it("ids are unique", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
