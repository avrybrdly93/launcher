import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  validateProjectileAssets,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers the §3.9 asset list: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id).sort();
    expect(ids).toEqual(
      ["baseball", "cannonball", "golf", "shot-put", "soccer", "sphere", "table-tennis"].sort(),
    );
  });

  it("validates every asset against the schema", () => {
    const validated = validateProjectileAssets();
    expect(validated).toHaveLength(PROJECTILE_ASSETS.length);
  });

  it("gives every asset a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("gives every numeric datum (mass, radius, and constant Cd) a citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass.citation.length).toBeGreaterThan(0);
      expect(asset.radius.citation.length).toBeGreaterThan(0);
      const drag = asset.dragCoefficient;
      const citation = drag.kind === "constant" ? drag.cd.citation : drag.citation;
      expect(citation.length).toBeGreaterThan(0);
    }
  });

  it("has physically positive mass and radius for every asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass.value).toBeGreaterThan(0);
      expect(asset.radius.value).toBeGreaterThan(0);
    }
  });
});

describe("ProjectileSpecSchema", () => {
  it("rejects a spec missing a citation", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1 }, // missing citation
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "constant", cd: { value: 0.47, citation: "test" } },
      provenance: "test",
    };
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
    expect(() => validateProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects an unknown drag-coefficient kind", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1, citation: "test" },
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "quadratic-fit" },
      provenance: "test",
    };
    expect(() => validateProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects an empty provenance string", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1, citation: "test" },
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "tabulated-reynolds", citation: "test" },
      provenance: "",
    };
    expect(() => validateProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });
});
