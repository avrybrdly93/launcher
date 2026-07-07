import { describe, expect, it } from "vitest";
import {
  loadProjectileSpec,
  projectileParamsFromSpec,
  ProjectileSpecSchema,
} from "./projectile-spec.js";
import { SchemaValidationError } from "./schema.js";

const VALID_RAW = {
  id: "test-ball",
  name: "Test ball",
  mass: 0.145,
  radius: 0.0366,
  dragCoefficient: { kind: "constant", value: 0.3 },
  liftCoefficient: { kind: "saturating" },
  spinDecayTau: 25,
  provenance: "Test fixture, not a real citation.",
};

describe("ProjectileSpecSchema / loadProjectileSpec", () => {
  it("parses a valid spec", () => {
    const spec = loadProjectileSpec(VALID_RAW);
    expect(spec.id).toBe("test-ball");
    expect(spec.mass).toBe(0.145);
    expect(spec.provenance.length).toBeGreaterThan(0);
  });

  it("rejects a spec missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...VALID_RAW };
    delete withoutProvenance.provenance;
    expect(() => loadProjectileSpec(withoutProvenance)).toThrow(SchemaValidationError);
  });

  it("rejects negative mass with a useful error message", () => {
    try {
      loadProjectileSpec({ ...VALID_RAW, mass: -1 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toMatch(/mass/);
    }
  });

  it("rejects an unrecognized dragCoefficient.kind", () => {
    expect(() =>
      loadProjectileSpec({ ...VALID_RAW, dragCoefficient: { kind: "bogus", value: 1 } }),
    ).toThrow(SchemaValidationError);
  });

  it("accepts a tabulated-reynolds drag model with an explicit table", () => {
    const spec = loadProjectileSpec({
      ...VALID_RAW,
      dragCoefficient: { kind: "tabulated-reynolds", table: { re: [1, 10], cd: [1, 0.5] } },
    });
    expect(spec.dragCoefficient.kind).toBe("tabulated-reynolds");
  });

  it("ProjectileSpecSchema.safeParse round-trips a valid object", () => {
    const result = ProjectileSpecSchema.safeParse(VALID_RAW);
    expect(result.success).toBe(true);
  });
});

describe("projectileParamsFromSpec", () => {
  it("derives area from radius and builds live coefficient models", () => {
    const spec = loadProjectileSpec(VALID_RAW);
    const params = projectileParamsFromSpec(spec);
    expect(params.mass).toBe(0.145);
    expect(params.radius).toBe(0.0366);
    expect(params.area).toBeCloseTo(Math.PI * 0.0366 * 0.0366, 12);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.3);
    expect(params.liftCoefficient?.cl(1)).toBeCloseTo(0.6, 12); // saturating at S=1: min(0.6, 1.6*1)
  });

  it("omits liftCoefficient when the spec doesn't declare one", () => {
    const withoutLift: Record<string, unknown> = { ...VALID_RAW };
    delete withoutLift.liftCoefficient;
    const spec = loadProjectileSpec(withoutLift);
    const params = projectileParamsFromSpec(spec);
    expect(params.liftCoefficient).toBeUndefined();
  });
});
