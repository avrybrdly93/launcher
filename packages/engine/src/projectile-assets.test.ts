import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { PROJECTILE_SPEC_SCHEMA } from "./projectile-spec.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball",
  "shot-put",
];

describe("PROJECTILE_ASSETS", () => {
  it("covers the §3.9 roster: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every asset validates against PROJECTILE_SPEC_SCHEMA", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(PROJECTILE_SPEC_SCHEMA, asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects a corrupt fixture with a useful error (negative mass)", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(() => parseWithSchema(PROJECTILE_SPEC_SCHEMA, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects a fixture missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance.provenance;
    expect(() => parseWithSchema(PROJECTILE_SPEC_SCHEMA, withoutProvenance)).toThrow(
      SchemaValidationError,
    );
  });
});
