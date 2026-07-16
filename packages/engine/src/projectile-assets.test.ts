import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships exactly the §3.9 asset list", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      [
        "sphere",
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
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset carries a top-level provenance string and cited mass/radius", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(0);
      expect(asset.mass.citation.length).toBeGreaterThan(0);
      expect(asset.radius.citation.length).toBeGreaterThan(0);
      expect(asset.mass.value).toBeGreaterThan(0);
      expect(asset.radius.value).toBeGreaterThan(0);
    }
  });

  it("a corrupt fixture (negative mass) is rejected by the schema", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: { value: -1, citation: "bad" } };
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
  });

  it("ids are unique", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("spans a physically sensible mass range (table-tennis ball lightest, shot put heaviest)", () => {
    const byId = new Map(PROJECTILE_ASSETS.map((a) => [a.id, a.mass.value]));
    expect(byId.get("table-tennis-ball")!).toBeLessThan(byId.get("golf-ball")!);
    expect(byId.get("golf-ball")!).toBeLessThan(byId.get("baseball")!);
    expect(byId.get("baseball")!).toBeLessThan(byId.get("soccer-ball")!);
    expect(byId.get("soccer-ball")!).toBeLessThan(byId.get("shot-put")!);
  });
});
