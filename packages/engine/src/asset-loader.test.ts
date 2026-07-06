import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadAssets } from "./asset-loader.js";
import { SchemaValidationError } from "./schema.js";

const WidgetSchema = z.object({
  id: z.string().min(1),
  weight: z.number().positive(),
});

describe("loadAssets (P1.26)", () => {
  it("parses every fixture that validates", () => {
    const widgets = loadAssets(
      WidgetSchema,
      [
        { id: "a", weight: 1 },
        { id: "b", weight: 2 },
      ],
      "widget",
    );
    expect(widgets).toEqual([
      { id: "a", weight: 1 },
      { id: "b", weight: 2 },
    ]);
  });

  it("rejects a corrupt fixture with a useful error naming its id", () => {
    const fixtures = [
      { id: "good", weight: 1 },
      { id: "corrupt", weight: -5 }, // invalid: must be positive
    ];
    expect(() => loadAssets(WidgetSchema, fixtures, "widget")).toThrow(SchemaValidationError);
    expect(() => loadAssets(WidgetSchema, fixtures, "widget")).toThrow(/widget asset \(corrupt\)/);
    expect(() => loadAssets(WidgetSchema, fixtures, "widget")).toThrow(/weight/);
  });

  it("falls back to a positional label when the corrupt fixture has no id", () => {
    const fixtures = [{ weight: -1 }];
    expect(() => loadAssets(WidgetSchema, fixtures, "widget")).toThrow(/widget asset \(index 0\)/);
  });
});
