import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema, parseProjectileSpec } from "./projectile-spec.js";
import { SchemaValidationError } from "./schema.js";

describe("PROJECTILE_ASSETS", () => {
  it("includes the roadmap's initial set: sphere, golf, soccer, baseball, table-tennis, cannonball, shot put", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(ids).toEqual([
      "sphere",
      "golf",
      "soccer",
      "baseball",
      "table-tennis",
      "cannonball",
      "shot-put",
    ]);
  });

  it("every asset independently validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids and positive mass/radius", () => {
    const ids = new Set(PROJECTILE_ASSETS.map((a) => a.id));
    expect(ids.size).toBe(PROJECTILE_ASSETS.length);
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });
});

describe("parseProjectileSpec", () => {
  it("accepts a well-formed spec", () => {
    const spec = parseProjectileSpec({
      id: "custom",
      name: "Custom sphere",
      mass: 0.2,
      radius: 0.03,
      dragCoefficient: { kind: "constant", cd: 0.5 },
      provenance: "test fixture",
    });
    expect(spec.id).toBe("custom");
  });

  it("rejects a corrupt fixture (negative mass) with a useful error", () => {
    expect(() =>
      parseProjectileSpec({
        id: "broken",
        name: "Broken",
        mass: -1,
        radius: 0.03,
        dragCoefficient: { kind: "constant", cd: 0.5 },
        provenance: "test fixture",
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects a fixture missing provenance", () => {
    expect(() =>
      parseProjectileSpec({
        id: "broken",
        name: "Broken",
        mass: 0.2,
        radius: 0.03,
        dragCoefficient: { kind: "constant", cd: 0.5 },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects an unknown dragCoefficient kind", () => {
    expect(() =>
      parseProjectileSpec({
        id: "broken",
        name: "Broken",
        mass: 0.2,
        radius: 0.03,
        dragCoefficient: { kind: "not-a-real-kind" },
        provenance: "test fixture",
      }),
    ).toThrow(SchemaValidationError);
  });
});
