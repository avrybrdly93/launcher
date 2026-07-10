import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AssetLoadError, loadAssets } from "./asset-loader.js";

const widgetSchema = z.object({ id: z.string(), mass: z.number().positive() });

describe("loadAssets", () => {
  it("parses every valid record", () => {
    const result = loadAssets(
      widgetSchema,
      [
        { id: "a", mass: 1 },
        { id: "b", mass: 2 },
      ],
      "widgets",
    );
    expect(result).toEqual([
      { id: "a", mass: 1 },
      { id: "b", mass: 2 },
    ]);
  });

  it("rejects a corrupt fixture with a useful error naming the source, index, and id", () => {
    const raw = [
      { id: "good", mass: 1 },
      { id: "bad-widget", mass: -5 },
    ];

    let caught: unknown;
    try {
      loadAssets(widgetSchema, raw, "widgets");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AssetLoadError);
    const error = caught as AssetLoadError;
    expect(error.source).toBe("widgets");
    expect(error.index).toBe(1);
    expect(error.message).toContain("widgets[1]");
    expect(error.message).toContain("bad-widget");
    expect(error.message).toContain("mass");
  });

  it("falls back to <no id> when the raw record has no string id", () => {
    let caught: unknown;
    try {
      loadAssets(widgetSchema, [{ mass: -1 }], "widgets");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AssetLoadError);
    expect((caught as AssetLoadError).message).toContain("<no id>");
  });
});
