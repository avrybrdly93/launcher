import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  resolveProjectileSpec,
  type ProjectileSpec,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("covers the required asset set", () => {
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
      expect(() => parseWithSchema(ProjectileSpecSchema, asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(10);
    }
  });

  it("every asset has a unique id and positive mass/radius", () => {
    const ids = new Set(PROJECTILE_ASSETS.map((a) => a.id));
    expect(ids.size).toBe(PROJECTILE_ASSETS.length);
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("resolveProjectileSpec produces usable runtime params for every asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = resolveProjectileSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e3, 0)).toBeGreaterThan(0);
      if (asset.liftCoefficient) {
        expect(params.liftCoefficient).toBeDefined();
        expect(params.liftCoefficient!.cl(0.1)).toBeGreaterThan(0);
      }
    }
  });

  it("cannonball mass is derived from a 0.1 m iron sphere (density x volume)", () => {
    const cannonball = PROJECTILE_ASSETS.find((a) => a.id === "cannonball")!;
    expect(cannonball.radius).toBeCloseTo(0.05, 15);
    const expectedMass = 7874 * ((4 / 3) * Math.PI * 0.05 ** 3);
    expect(cannonball.mass).toBeCloseTo(expectedMass, 10);
  });

  it("rejects a corrupt fixture with a useful error", () => {
    const corrupt = {
      id: "bad",
      name: "bad",
      mass: -1, // invalid: must be positive
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "",
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
    expect(() => parseWithSchema(ProjectileSpecSchema, corrupt)).toThrow(/mass/);
  });
});

describe("ProjectileSpecSchema", () => {
  it("accepts a tabulated-reynolds drag coefficient with no lift model", () => {
    const spec: ProjectileSpec = {
      id: "x",
      name: "x",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "tabulated-reynolds" },
      provenance: "test fixture",
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, spec)).not.toThrow();
  });
});
