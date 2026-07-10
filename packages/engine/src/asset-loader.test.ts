import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadAssetArray } from "./asset-loader.js";
import { SchemaValidationError } from "./schema.js";

const WidgetSchema = z.object({ id: z.string().min(1), weight: z.number().positive() });

/** Runs `fn`, returning the thrown error (asserting one was thrown). */
function captureThrow(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected fn to throw");
}

describe("loadAssetArray", () => {
  it("parses a valid raw array into typed records", () => {
    const raw: unknown[] = [
      { id: "a", weight: 1 },
      { id: "b", weight: 2.5 },
    ];
    expect(loadAssetArray(WidgetSchema, raw, "Widget")).toEqual(raw);
  });

  it("rejects a corrupt fixture with a useful error identifying its index and id", () => {
    const raw: unknown[] = [
      { id: "good", weight: 1 },
      { id: "corrupt-entry", weight: -5 }, // invalid: weight must be positive
    ];

    expect(() => loadAssetArray(WidgetSchema, raw, "Widget")).toThrow(SchemaValidationError);
    const error = captureThrow(() => loadAssetArray(WidgetSchema, raw, "Widget"));
    expect(error).toBeInstanceOf(SchemaValidationError);
    const message = (error as SchemaValidationError).message;
    expect(message).toContain("Widget[1]");
    expect(message).toContain("corrupt-entry");
    expect(message).toMatch(/weight/);
  });

  it("identifies a corrupt fixture missing an id as '?'", () => {
    const raw: unknown[] = [{ weight: -1 }];
    const error = captureThrow(() => loadAssetArray(WidgetSchema, raw, "Widget"));
    expect((error as SchemaValidationError).message).toContain("Widget[0] (id=?)");
  });
});
