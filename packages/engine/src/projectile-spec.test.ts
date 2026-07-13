import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import {
  createProjectileParamsFromSpec,
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships the 7 initial data assets (§3.9)", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      [
        "baseball",
        "cannonball-0.1m-iron",
        "golf-ball",
        "shot-put",
        "smooth-sphere",
        "soccer-ball",
        "table-tennis-ball",
      ].sort(),
    );
  });

  it("every asset validates against ProjectileSpecSchema and carries a provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const parsed = parseWithSchema(ProjectileSpecSchema, asset);
      expect(parsed).toEqual(asset);
      expect(typeof parsed.provenance).toBe("string");
      expect(parsed.provenance.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects an asset missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance.provenance;
    expect(() => parseWithSchema(ProjectileSpecSchema, withoutProvenance)).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects a negative mass", () => {
    const bad = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(() => parseWithSchema(ProjectileSpecSchema, bad)).toThrow(SchemaValidationError);
  });
});

describe("createProjectileParamsFromSpec", () => {
  it("builds ProjectileParams with a live ConstantCd instance matching the spec", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "soccer-ball")!;
    const params = createProjectileParamsFromSpec(spec);
    expect(params.mass).toBe(spec.mass);
    expect(params.radius).toBe(spec.radius);
    expect(params.dragCoefficient.cd(0, 0)).toBeCloseTo(0.25, 12);
    expect(params.area).toBeCloseTo(Math.PI * spec.radius * spec.radius, 12);
  });

  it("wires an optional lift coefficient and spin from a spec that declares one", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    const params = createProjectileParamsFromSpec(spec, 300);
    expect(params.liftCoefficient).toBeDefined();
    expect(params.liftCoefficient!.cl(1)).toBeCloseTo(0.6, 12); // saturates
    expect(params.spin).toBe(300);
  });

  it("omits liftCoefficient for a spec without one", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;
    const params = createProjectileParamsFromSpec(spec);
    expect(params.liftCoefficient).toBeUndefined();
  });
});
