import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  projectileParamsFromSpec,
} from "./projectile-spec.js";

describe("ProjectileSpecSchema", () => {
  it("validates every built-in asset and requires a non-empty provenance string", () => {
    expect(PROJECTILE_ASSETS.length).toBe(7);
    for (const asset of PROJECTILE_ASSETS) {
      const parsed = parseWithSchema(ProjectileSpecSchema, asset);
      expect(parsed).toEqual(asset);
      expect(typeof parsed.provenance).toBe("string");
      expect(parsed.provenance.length).toBeGreaterThan(0);
    }
  });

  it("covers the expected asset ids", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([
      "baseball",
      "cannonball",
      "golf-ball",
      "shot-put",
      "smooth-sphere",
      "soccer-ball",
      "table-tennis-ball",
    ]);
  });

  it("rejects a corrupt asset (negative mass, missing provenance)", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        id: "bad",
        label: "Bad asset",
        mass: -1,
        radius: 0.05,
        dragCoefficient: 0.47,
        provenance: "",
      }),
    ).toThrow(SchemaValidationError);
  });

  it("converts to runtime ProjectileParams usable by the engine", () => {
    const golf = PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    const params = projectileParamsFromSpec(golf);
    expect(params.mass).toBe(golf.mass);
    expect(params.radius).toBe(golf.radius);
    expect(params.dragCoefficient.cd(1e5, 0.1)).toBe(golf.dragCoefficient);
  });
});
