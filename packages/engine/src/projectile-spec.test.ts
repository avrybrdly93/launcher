import { describe, expect, it } from "vitest";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { SchemaValidationError, parseWithSchema } from "./schema.js";
import { ProjectileSpecSchema, resolveProjectileSpec } from "./projectile-spec.js";

const VALID_SPEC = {
  id: "test-ball",
  name: "Test ball",
  mass: 0.145,
  radius: 0.0366,
  dragModel: { kind: "constant", cd: 0.47 },
  provenance: "unit test fixture",
};

describe("ProjectileSpecSchema", () => {
  it("parses a valid constant-Cd spec", () => {
    const spec = parseWithSchema(ProjectileSpecSchema, VALID_SPEC);
    expect(spec.mass).toBe(0.145);
    expect(spec.dragModel).toEqual({ kind: "constant", cd: 0.47 });
  });

  it("parses a valid spec with a tabulated drag model and a lift model", () => {
    const spec = parseWithSchema(ProjectileSpecSchema, {
      ...VALID_SPEC,
      dragModel: { kind: "tabulated-smooth-sphere" },
      liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
      spinDecayTau: 25,
    });
    expect(spec.liftModel).toEqual({ kind: "saturating", maxCl: 0.6, slope: 1.6 });
    expect(spec.spinDecayTau).toBe(25);
  });

  it("rejects a spec missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...VALID_SPEC };
    delete withoutProvenance.provenance;
    expect(() => parseWithSchema(ProjectileSpecSchema, withoutProvenance)).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects non-positive mass/radius", () => {
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...VALID_SPEC, mass: 0 })).toThrow(
      SchemaValidationError,
    );
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...VALID_SPEC, radius: -1 })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects an unrecognized drag-model kind", () => {
    expect(() =>
      parseWithSchema(ProjectileSpecSchema, { ...VALID_SPEC, dragModel: { kind: "bogus" } }),
    ).toThrow(SchemaValidationError);
  });
});

describe("resolveProjectileSpec", () => {
  it("resolves a constant-Cd spec to ConstantCd with derived area/volume", () => {
    const spec = parseWithSchema(ProjectileSpecSchema, VALID_SPEC);
    const params = resolveProjectileSpec(spec);
    expect(params.mass).toBe(0.145);
    expect(params.radius).toBe(0.0366);
    expect(params.dragCoefficient).toBeInstanceOf(ConstantCd);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.47);
    expect(params.area).toBeCloseTo(Math.PI * 0.0366 * 0.0366, 12);
    expect(params.volume).toBeCloseTo((4 / 3) * Math.PI * 0.0366 ** 3, 12);
    expect(params.liftCoefficient).toBeUndefined();
  });

  it("resolves a tabulated-drag + lift spec with spin passed through", () => {
    const spec = parseWithSchema(ProjectileSpecSchema, {
      ...VALID_SPEC,
      dragModel: { kind: "tabulated-smooth-sphere" },
      liftModel: { kind: "saturating", maxCl: 0.6, slope: 1.6 },
    });
    const params = resolveProjectileSpec(spec, 180);
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
    expect(params.liftCoefficient).toBeInstanceOf(SaturatingLiftCoefficient);
    expect(params.spin).toBe(180);
  });
});
