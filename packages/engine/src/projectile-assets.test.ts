import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships exactly the seven initial presets named in §3.9", () => {
    expect(PROJECTILE_ASSETS.map((spec) => spec.id).sort()).toEqual([
      "baseball",
      "cannonball",
      "golf-ball",
      "shot-put",
      "smooth-sphere",
      "soccer-ball",
      "table-tennis-ball",
    ]);
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const spec of PROJECTILE_ASSETS) {
    it(`${spec.id} validates against ProjectileSpecSchema and carries a provenance string`, () => {
      const parsed = parseWithSchema(ProjectileSpecSchema, spec);
      expect(parsed).toEqual(spec);
      expect(typeof spec.provenance).toBe("string");
      expect(spec.provenance.length).toBeGreaterThan(0);
    });
  }
});

describe("ProjectileSpecSchema", () => {
  it("rejects a corrupt spec (negative mass)", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        id: "bad",
        name: "Bad",
        mass: -1,
        radius: 0.05,
        dragModel: "constant",
        constantCd: 0.47,
        provenance: "test fixture",
      }),
    ).toThrow();
  });

  it("rejects a 'constant' drag model missing constantCd", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        id: "bad",
        name: "Bad",
        mass: 1,
        radius: 0.05,
        dragModel: "constant",
        provenance: "test fixture",
      }),
    ).toThrow();
  });

  it("accepts a 'tabulated-reynolds' drag model without constantCd", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        id: "ok",
        name: "OK",
        mass: 1,
        radius: 0.05,
        dragModel: "tabulated-reynolds",
        provenance: "test fixture",
      }),
    ).not.toThrow();
  });
});
