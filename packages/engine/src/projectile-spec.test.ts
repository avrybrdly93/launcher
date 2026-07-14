import { describe, expect, it } from "vitest";
import { projectileSpecSchema } from "./projectile-spec.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

describe("projectileSpecSchema", () => {
  const valid = {
    id: "test-ball",
    name: "Test ball",
    mass: 0.1,
    radius: 0.05,
    dragModel: { type: "constant", cd: 0.47 },
    liftModel: { type: "none" },
    provenance: "unit test fixture",
  };

  it("accepts a valid spec", () => {
    expect(parseWithSchema(projectileSpecSchema, valid)).toEqual(valid);
  });

  it("accepts a tabulated-reynolds drag model and a saturating lift model", () => {
    const spec = {
      ...valid,
      dragModel: { type: "tabulated-reynolds", table: { re: [1e2, 1e3], cd: [1.1, 0.47] } },
      liftModel: { type: "saturating", maxCl: 0.6, slope: 1.6 },
      spinDecayTauSeconds: 25,
    };
    expect(parseWithSchema(projectileSpecSchema, spec)).toEqual(spec);
  });

  it("rejects a tabulated-reynolds table with mismatched re/cd lengths", () => {
    const spec = {
      ...valid,
      dragModel: { type: "tabulated-reynolds", table: { re: [1e2, 1e3], cd: [1.1] } },
    };
    expect(() => parseWithSchema(projectileSpecSchema, spec)).toThrow(SchemaValidationError);
  });

  it("rejects a non-positive mass", () => {
    expect(() => parseWithSchema(projectileSpecSchema, { ...valid, mass: 0 })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects a missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...valid };
    delete withoutProvenance["provenance"];
    expect(() => parseWithSchema(projectileSpecSchema, withoutProvenance)).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects an empty provenance string", () => {
    expect(() => parseWithSchema(projectileSpecSchema, { ...valid, provenance: "" })).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects an unknown dragModel discriminant with a useful error", () => {
    try {
      parseWithSchema(projectileSpecSchema, { ...valid, dragModel: { type: "bogus" } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toMatch(/dragModel/);
    }
  });
});
