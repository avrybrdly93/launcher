import { describe, expect, it } from "vitest";
import { SchemaValidationError, parseWithSchema } from "./schema.js";
import {
  createProjectileParamsFromSpec,
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  resolveDragCoefficientModel,
  type ProjectileSpec,
} from "./projectile-assets.js";

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("covers exactly the required initial set of assets", () => {
    const names = PROJECTILE_ASSETS.map((asset) => asset.name).sort();
    expect(names).toEqual(
      [
        "baseball",
        "cannonball-iron-0.1m",
        "golf-ball",
        "shot-put",
        "smooth-sphere",
        "soccer-ball",
        "table-tennis-ball",
      ].sort(),
    );
  });

  it("every asset validates against ProjectileSpecSchema and carries a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(ProjectileSpecSchema, asset)).not.toThrow();
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("every asset resolves to a finite, positive drag coefficient", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const cd = resolveDragCoefficientModel(asset.dragCoefficient).cd(1e4, 0);
      expect(Number.isFinite(cd)).toBe(true);
      expect(cd).toBeGreaterThan(0);
    }
  });

  it("every asset builds valid runtime ProjectileParams with positive derived area/volume", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = createProjectileParamsFromSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.volume).toBeGreaterThan(0);
    }
  });

  it("the smooth sphere uses the tabulated drag-crisis Reynolds model, not a constant Cd", () => {
    const sphere = PROJECTILE_ASSETS.find((asset) => asset.name === "smooth-sphere")!;
    expect(sphere.dragCoefficient.kind).toBe("tabulated-smooth-sphere-reynolds");
    const model = resolveDragCoefficientModel(sphere.dragCoefficient);
    // Drag crisis: Cd should fall sharply between Re=1e5 and Re=3e5 (P1.10-13).
    expect(model.cd(1e5, 0)).toBeGreaterThan(model.cd(3e5, 0));
  });
});

describe("ProjectileSpecSchema (P1.25 asset-loader validation)", () => {
  it("rejects a spec with non-positive mass", () => {
    const invalid = {
      name: "broken",
      mass: -1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", cd: 0.47 },
      provenance: "test fixture",
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, invalid)).toThrow(SchemaValidationError);
  });

  it("rejects a spec with an empty provenance string", () => {
    const invalid: Partial<ProjectileSpec> = {
      name: "broken",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", cd: 0.47 },
      provenance: "",
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, invalid)).toThrow(SchemaValidationError);
  });

  it("rejects an unrecognized dragCoefficient.kind", () => {
    const invalid = {
      name: "broken",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "made-up-model" },
      provenance: "test fixture",
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, invalid)).toThrow(SchemaValidationError);
  });
});
