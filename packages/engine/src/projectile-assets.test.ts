import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { ProjectileSpecSchema, createProjectileParamsFromSpec } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball-0.1m-iron",
  "shot-put",
];

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("includes exactly the required preset set: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(ProjectileSpecSchema, asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(10);
    }
  });

  it("every asset produces finite, physically sane ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = createProjectileParamsFromSpec(asset);
      expect(params.mass).toBeGreaterThan(0);
      expect(params.radius).toBeGreaterThan(0);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 10);
      expect(params.volume).toBeCloseTo((4 / 3) * Math.PI * asset.radius ** 3, 10);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });

  it("wires liftCoefficient only for the golf ball (the only asset that declares one)", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = createProjectileParamsFromSpec(asset);
      if (asset.id === "golf-ball") {
        expect(params.liftCoefficient).toBeDefined();
      } else {
        expect(params.liftCoefficient).toBeUndefined();
      }
    }
  });
});

describe("ProjectileSpecSchema rejects corrupt fixtures with a useful error (P1.26)", () => {
  it("rejects negative mass", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
    try {
      parseWithSchema(ProjectileSpecSchema, corrupt);
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      expect((e as SchemaValidationError).message).toContain("mass");
    }
  });

  it("rejects a missing provenance field", () => {
    const corrupt: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete corrupt.provenance;
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
    try {
      parseWithSchema(ProjectileSpecSchema, corrupt);
    } catch (e) {
      expect((e as SchemaValidationError).message).toContain("provenance");
    }
  });

  it("rejects an unrecognized dragCoefficient.kind discriminant", () => {
    const corrupt = {
      ...PROJECTILE_ASSETS[0]!,
      dragCoefficient: { kind: "not-a-real-model", value: 1 },
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });
});
