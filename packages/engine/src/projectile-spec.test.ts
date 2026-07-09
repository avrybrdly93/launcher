import { describe, expect, it } from "vitest";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";

describe("ProjectileSpecSchema", () => {
  const valid = {
    id: "test-ball",
    name: "Test ball",
    mass: 0.1,
    radius: 0.02,
    dragModel: { type: "constant", cd: 0.47 },
    provenance: "unit test fixture",
  };

  it("parses a minimal valid spec (no optional lift model/spin decay)", () => {
    const parsed = parseWithSchema(ProjectileSpecSchema, valid);
    expect(parsed.id).toBe("test-ball");
    expect(parsed.liftModel).toBeUndefined();
  });

  it("parses a full spec with lift model, spin decay, and tabulated drag", () => {
    const full = {
      ...valid,
      dragModel: { type: "tabulated-reynolds", re: [1e2, 1e3, 1e4], cd: [1.1, 0.47, 0.5] },
      liftModel: { type: "saturating", maxCl: 0.6, slope: 1.6 },
      spinDecayTau: 25,
    };
    expect(() => parseWithSchema(ProjectileSpecSchema, full)).not.toThrow();
  });

  it("rejects a non-positive mass with a useful error", () => {
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...valid, mass: -1 })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects an empty provenance string", () => {
    expect(() => parseWithSchema(ProjectileSpecSchema, { ...valid, provenance: "" })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects a tabulated drag model with fewer than 2 points", () => {
    const bad = { ...valid, dragModel: { type: "tabulated-reynolds", re: [1e2], cd: [0.47] } };
    expect(() => parseWithSchema(ProjectileSpecSchema, bad)).toThrow(SchemaValidationError);
  });

  it("rejects an unknown dragModel discriminant", () => {
    const bad = { ...valid, dragModel: { type: "mach-dependent", cd: 0.47 } };
    expect(() => parseWithSchema(ProjectileSpecSchema, bad)).toThrow(SchemaValidationError);
  });
});
