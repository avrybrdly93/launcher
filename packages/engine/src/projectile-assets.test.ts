import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

describe("PROJECTILE_ASSETS (P1.25)", () => {
  it("includes exactly the seven §3.9 assets", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.name).sort()).toEqual(
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

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(ProjectileSpecSchema, asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("every asset has physically sane, positive mass and radius", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });
});

describe("ProjectileSpecSchema", () => {
  it("rejects a corrupt spec with a useful error (negative mass)", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        name: "broken",
        mass: -1,
        radius: 0.05,
        dragCoefficient: { type: "constant", value: 0.47 },
        provenance: "test fixture",
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects a spec missing provenance", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        name: "no-provenance",
        mass: 1,
        radius: 0.05,
        dragCoefficient: { type: "constant", value: 0.47 },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects a tabulatedReynolds drag coefficient with mismatched re/cd lengths", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, {
        name: "mismatched-table",
        mass: 1,
        radius: 0.05,
        dragCoefficient: {
          type: "tabulatedReynolds",
          table: { re: [1, 2, 3], cd: [0.4, 0.5] },
        },
        provenance: "test fixture",
      }),
    ).toThrow(SchemaValidationError);
  });

  it("accepts a minimal valid spec (no lift, no spin decay)", () => {
    const parsed = parseWithSchema(ProjectileSpecSchema, {
      name: "custom",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { type: "constant", value: 0.47 },
      provenance: "test fixture",
    });
    expect(parsed.liftCoefficient).toBeUndefined();
    expect(parsed.spinDecayTau).toBeUndefined();
  });
});
