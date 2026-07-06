import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS, PROJECTILE_SPEC_SCHEMA } from "./projectile-assets.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball",
  "shot-put",
];

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("ships exactly the roadmap's required projectiles: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS.map((asset) => asset.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((asset) => asset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every asset validates against PROJECTILE_SPEC_SCHEMA and carries a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const parsed = parseWithSchema(PROJECTILE_SPEC_SCHEMA, asset);
      expect(parsed).toEqual(asset);
      expect(typeof parsed.provenance).toBe("string");
      expect(parsed.provenance.length).toBeGreaterThan(0);
    }
  });

  it("has positive mass and radius for every asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupted spec (missing provenance) with a useful error", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "constant", value: 0.47 },
      // provenance omitted
    };
    expect(() => parseWithSchema(PROJECTILE_SPEC_SCHEMA, corrupt)).toThrow(SchemaValidationError);
    try {
      parseWithSchema(PROJECTILE_SPEC_SCHEMA, corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain("provenance");
    }
  });

  it("rejects a negative mass", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: -1,
      radius: 0.1,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "n/a",
    };
    expect(() => parseWithSchema(PROJECTILE_SPEC_SCHEMA, corrupt)).toThrow(SchemaValidationError);
  });
});
