import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  parseProjectileSpec,
  projectileParamsFromSpec,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
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

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset carries a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(10);
    }
  });

  it("resolves into usable ProjectileParams via projectileParamsFromSpec", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = projectileParamsFromSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });

  it("the cannonball's mass is derived from iron density at r=0.05m", () => {
    const cannonball = PROJECTILE_ASSETS.find((a) => a.id === "cannonball")!;
    const expectedMass = 7870 * (4 / 3) * Math.PI * 0.05 ** 3;
    expect(cannonball.mass).toBeCloseTo(expectedMass, 9);
  });
});

describe("parseProjectileSpec (P1.26 asset loader)", () => {
  it("rejects a corrupt fixture (negative mass) with a useful error", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: -1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "test fixture",
    };
    expect(() => parseProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    try {
      parseProjectileSpec(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("mass");
    }
  });

  it("rejects a fixture missing provenance with a useful error", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
    };
    expect(() => parseProjectileSpec(corrupt)).toThrow(/provenance/);
  });

  it("rejects an unknown dragCoefficient kind", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "not-a-real-model" },
      provenance: "test fixture",
    };
    expect(() => parseProjectileSpec(corrupt)).toThrow(SchemaValidationError);
  });

  it("accepts a valid custom spec", () => {
    const spec = parseProjectileSpec({
      id: "custom",
      name: "Custom",
      mass: 0.2,
      radius: 0.03,
      dragCoefficient: { kind: "tabulated-reynolds" },
      provenance: "hand-entered for a test",
    });
    expect(spec.id).toBe("custom");
  });
});
