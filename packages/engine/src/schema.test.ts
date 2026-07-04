import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseWithSchema, SchemaValidationError } from "./schema.js";

describe("parseWithSchema", () => {
  const positiveNumber = z.object({ mass: z.number().positive() });

  it("parses valid data", () => {
    expect(parseWithSchema(positiveNumber, { mass: 1.5 })).toEqual({ mass: 1.5 });
  });

  it("rejects invalid data with a useful error", () => {
    expect(() => parseWithSchema(positiveNumber, { mass: -1 })).toThrow(SchemaValidationError);
  });
});
