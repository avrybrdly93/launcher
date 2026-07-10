import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  toProjectileParams,
  type ProjectileSpec,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("has one asset each for sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(ids).toEqual([
      "smooth-sphere",
      "golf-ball",
      "soccer-ball",
      "baseball",
      "table-tennis-ball",
      "cannonball",
      "shot-put",
    ]);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  it.each(PROJECTILE_ASSETS.map((asset) => [asset.id, asset] as const))(
    "%s validates against ProjectileSpecSchema and carries a non-empty provenance",
    (_id, asset) => {
      const parsed = parseWithSchema(ProjectileSpecSchema, asset);
      expect(parsed).toEqual(asset);
      expect(asset.provenance.length).toBeGreaterThan(20);
    },
  );

  it.each(PROJECTILE_ASSETS.map((asset) => [asset.id, asset] as const))(
    "%s converts to ProjectileParams with matching mass/radius and derived area/volume",
    (_id, asset) => {
      const params = toProjectileParams(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 15);
      expect(params.dragCoefficient.cd(1e5, 0)).toBe(asset.dragCoefficient);
      if (asset.liftCoefficient === "saturating") {
        expect(params.liftCoefficient).toBeDefined();
      } else {
        expect(params.liftCoefficient).toBeUndefined();
      }
    },
  );
});

describe("ProjectileSpecSchema", () => {
  it("rejects a corrupt fixture with a useful error", () => {
    const corrupt = {
      id: "broken",
      name: "Broken",
      mass: -1, // invalid: must be positive
      radius: 0.05,
      dragCoefficient: 0.47,
      provenance: "",
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
    try {
      parseWithSchema(ProjectileSpecSchema, corrupt);
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      expect((e as SchemaValidationError).message).toMatch(/mass/);
    }
  });

  it("rejects a fixture missing provenance", () => {
    const missingProvenance: Omit<ProjectileSpec, "provenance"> = {
      id: "x",
      name: "X",
      mass: 1,
      radius: 0.05,
      dragCoefficient: 0.47,
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, missingProvenance)).toThrow(
      SchemaValidationError,
    );
  });
});
