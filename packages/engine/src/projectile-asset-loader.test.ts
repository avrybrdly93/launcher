import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { loadProjectileSpec } from "./projectile-asset-loader.js";
import { GOLF_BALL } from "./projectile-assets.js";

describe("loadProjectileSpec", () => {
  it("accepts a well-formed spec", () => {
    expect(loadProjectileSpec(GOLF_BALL)).toEqual(GOLF_BALL);
  });

  it("rejects a corrupt fixture (missing citation) with a useful, path-qualified error", () => {
    const corrupt = {
      id: "corrupt",
      name: "Corrupt fixture",
      mass: { value: 1 }, // missing required `citation`
      radius: { value: 0.05, citation: "test" },
      dragModel: { kind: "constant", cd: 0.47, citation: "test" },
      liftModel: { kind: "none" },
      provenance: "test",
    };

    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileSpec(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const validationError = err as SchemaValidationError;
      expect(validationError.message).toContain("mass.citation");
      expect(validationError.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt fixture (negative mass) with a useful error", () => {
    const corrupt = {
      id: "corrupt",
      name: "Corrupt fixture",
      mass: { value: -1, citation: "test" },
      radius: { value: 0.05, citation: "test" },
      dragModel: { kind: "constant", cd: 0.47, citation: "test" },
      liftModel: { kind: "none" },
      provenance: "test",
    };

    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects a corrupt fixture (unknown dragModel.kind) with a useful error", () => {
    const corrupt = {
      id: "corrupt",
      name: "Corrupt fixture",
      mass: { value: 1, citation: "test" },
      radius: { value: 0.05, citation: "test" },
      dragModel: { kind: "made-up-model", citation: "test" },
      liftModel: { kind: "none" },
      provenance: "test",
    };

    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects entirely non-object input", () => {
    expect(() => loadProjectileSpec(null)).toThrow(SchemaValidationError);
    expect(() => loadProjectileSpec("not a spec")).toThrow(SchemaValidationError);
    expect(() => loadProjectileSpec(undefined)).toThrow(SchemaValidationError);
  });
});
