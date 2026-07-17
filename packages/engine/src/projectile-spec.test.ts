import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { projectileSpecSchema, projectileSpecToParams } from "./projectile-spec.js";

describe("projectileSpecSchema", () => {
  it("validates every asset in the projectile library", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(projectileSpecSchema, asset)).not.toThrow();
    }
  });

  it("gives every asset a non-empty provenance citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("has a unique id per asset", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the seven presets named in the blueprint (§3.9)", () => {
    const ids = new Set(PROJECTILE_ASSETS.map((a) => a.id));
    expect(ids).toEqual(
      new Set([
        "smooth-sphere",
        "golf-ball",
        "soccer-ball",
        "baseball",
        "table-tennis-ball",
        "cannonball",
        "shot-put",
      ]),
    );
  });

  it("rejects a spec missing provenance", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: 1,
      radius: 0.1,
      dragModel: { kind: "constant", cd: 0.47 },
      provenance: "",
    };
    expect(() => parseWithSchema(projectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects non-positive mass/radius", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: 0,
      radius: -1,
      dragModel: { kind: "constant", cd: 0.47 },
      provenance: "citation",
    };
    expect(() => parseWithSchema(projectileSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });
});

describe("projectileSpecToParams", () => {
  it("derives area/volume from radius and wires the drag/lift models for every asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = projectileSpecToParams(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e4, 0.1)).toBeGreaterThan(0);
      if (asset.liftModel !== undefined && asset.liftModel.kind !== "none") {
        expect(params.liftCoefficient).toBeDefined();
        expect(params.liftCoefficient?.cl(0.2)).toBeGreaterThan(0);
      } else {
        expect(params.liftCoefficient).toBeUndefined();
      }
    }
  });
});
