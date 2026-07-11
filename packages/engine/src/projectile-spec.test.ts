import { describe, expect, it } from "vitest";
import {
  findProjectileAsset,
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  type ProjectileSpec,
} from "./projectile-spec.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

describe("ProjectileSpecSchema", () => {
  const valid: ProjectileSpec = {
    id: "test-ball",
    name: "Test ball",
    mass: 1,
    radius: 0.1,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance: "made up for this test",
  };

  it("accepts a well-formed spec", () => {
    expect(parseWithSchema(ProjectileSpecSchema, valid)).toEqual(valid);
  });

  it("accepts an optional liftCoefficient and spinDecayTau", () => {
    const withLift: ProjectileSpec = {
      ...valid,
      liftCoefficient: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
      spinDecayTau: 25,
    };
    expect(parseWithSchema(ProjectileSpecSchema, withLift)).toEqual(withLift);
  });

  it("accepts a tabulated-reynolds drag coefficient descriptor", () => {
    const tabulated: ProjectileSpec = {
      ...valid,
      dragCoefficient: { kind: "tabulated-reynolds", re: [1e2, 1e5], cd: [1.1, 0.5] },
    };
    expect(parseWithSchema(ProjectileSpecSchema, tabulated)).toEqual(tabulated);
  });

  it("rejects a spec missing provenance", () => {
    const missingProvenance: Record<string, unknown> = { ...valid };
    delete missingProvenance["provenance"];
    expect(() => parseWithSchema(ProjectileSpecSchema, missingProvenance)).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects a spec with an empty provenance string", () => {
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...valid, provenance: "" })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects non-positive mass or radius", () => {
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...valid, mass: 0 })).toThrow(
      SchemaValidationError,
    );
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...valid, radius: -1 })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects an unrecognized dragCoefficient kind", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, { ...valid, dragCoefficient: { kind: "bogus" } }),
    ).toThrow(SchemaValidationError);
  });
});

describe("PROJECTILE_ASSETS (P1.25 validation: assets validate; each has provenance string)", () => {
  const expectedIds = [
    "smooth-sphere",
    "golf-ball",
    "soccer-ball",
    "baseball",
    "table-tennis-ball",
    "cannonball",
    "shot-put",
  ];

  it("ships exactly the sphere/golf/soccer/baseball/TT/cannonball/shot-put set", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([...expectedIds].sort());
  });

  it("every asset validates against ProjectileSpecSchema and has a non-empty provenance", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(ProjectileSpecSchema, asset)).not.toThrow();
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("every asset has physically plausible positive mass/radius", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("findProjectileAsset looks up by id and returns undefined for an unknown id", () => {
    expect(findProjectileAsset("baseball")?.name).toBe("Baseball");
    expect(findProjectileAsset("nonexistent")).toBeUndefined();
  });
});
