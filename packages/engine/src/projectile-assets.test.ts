import { describe, expect, it } from "vitest";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  createProjectileParamsFromSpec,
  loadProjectileAsset,
} from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("covers the §3.9 initial database: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
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
      const parsed = ProjectileSpecSchema.parse(asset);
      expect(parsed.provenance.length).toBeGreaterThan(0);
      expect(parsed.mass).toBeGreaterThan(0);
      expect(parsed.radius).toBeGreaterThan(0);
    }
  });

  it("resolves into runtime ProjectileParams with matching mass/radius and derived area/volume", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = createProjectileParamsFromSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });
});

describe("loadProjectileAsset (P1.26 asset loader)", () => {
  it("accepts every built-in asset unchanged", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(loadProjectileAsset(asset)).toEqual(asset);
    }
  });

  it("rejects a corrupt fixture (missing mass) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]! } as Record<string, unknown>;
    delete corrupt.mass;

    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const message = (err as SchemaValidationError).message;
      expect(message).toContain("mass");
    }
  });

  it("rejects a corrupt fixture (negative radius) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, radius: -1 };

    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("radius");
    }
  });

  it("rejects an unknown dragCoefficient.kind discriminant", () => {
    const corrupt = {
      ...PROJECTILE_ASSETS[0]!,
      dragCoefficient: { kind: "not-a-real-model" },
    };

    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
  });
});
