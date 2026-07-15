import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadJsonAsset, parseWithSchema, SchemaValidationError } from "./schema.js";

describe("parseWithSchema", () => {
  const positiveNumber = z.object({ mass: z.number().positive() });

  it("parses valid data", () => {
    expect(parseWithSchema(positiveNumber, { mass: 1.5 })).toEqual({ mass: 1.5 });
  });

  it("rejects invalid data with a useful error", () => {
    expect(() => parseWithSchema(positiveNumber, { mass: -1 })).toThrow(SchemaValidationError);
  });
});

describe("loadJsonAsset (P1.26)", () => {
  const positiveNumber = z.object({ mass: z.number().positive() });

  it("parses a valid JSON fixture", () => {
    expect(loadJsonAsset(positiveNumber, '{"mass": 1.5}')).toEqual({ mass: 1.5 });
  });

  it("rejects a syntactically corrupt fixture with a useful error, not a bare SyntaxError", () => {
    expect(() => loadJsonAsset(positiveNumber, "{ this is not json")).toThrow(
      SchemaValidationError,
    );
    try {
      loadJsonAsset(positiveNumber, "{ this is not json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toMatch(/not valid JSON/);
    }
  });

  it("rejects well-formed JSON that fails the schema, naming the offending field", () => {
    try {
      loadJsonAsset(positiveNumber, '{"mass": -1}');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toMatch(/mass/);
    }
  });
});
