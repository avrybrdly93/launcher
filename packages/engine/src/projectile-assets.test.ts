import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { loadProjectileSpec, projectileParamsFromSpec } from "./projectile-spec.js";
import { SchemaValidationError } from "./schema.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships the seven initial data assets (§3.9)", () => {
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

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every asset validates and carries a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => loadProjectileSpec(asset)).not.toThrow();
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("every asset converts to usable ProjectileParams (positive mass/radius/area)", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = projectileParamsFromSpec(asset);
      expect(params.mass).toBeGreaterThan(0);
      expect(params.radius).toBeGreaterThan(0);
      expect(params.area).toBeGreaterThan(0);
      expect(params.volume).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt fixture with a useful error (P1.26)", () => {
    const corrupt = {
      id: "corrupt",
      name: "Corrupt fixture",
      mass: -5, // invalid: must be positive
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "deliberately broken for the loader-rejection test",
    };
    try {
      loadProjectileSpec(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toMatch(/mass/);
      expect((err as SchemaValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects a fixture missing required fields entirely", () => {
    expect(() => loadProjectileSpec({ id: "incomplete" })).toThrow(SchemaValidationError);
  });
});
