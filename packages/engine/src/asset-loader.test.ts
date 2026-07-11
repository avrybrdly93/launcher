import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AssetLoadError, loadAssets } from "./asset-loader.js";

const widgetSchema = z.object({
  id: z.string().min(1),
  weight: z.number().positive(),
});

describe("loadAssets", () => {
  it("returns parsed data when every entry is well-formed", () => {
    const raw = [
      { id: "a", weight: 1 },
      { id: "b", weight: 2 },
    ];
    expect(loadAssets(widgetSchema, raw, "widgets")).toEqual(raw);
  });

  it("rejects a corrupt fixture with a useful error naming the source, asset id, and cause", () => {
    const raw = [
      { id: "good", weight: 1 },
      { id: "corrupt", weight: -5 },
    ];

    let thrown: unknown;
    try {
      loadAssets(widgetSchema, raw, "widgets");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AssetLoadError);
    const error = thrown as AssetLoadError;
    expect(error.message).toContain("widgets");
    expect(error.message).toContain("corrupt");
    expect(error.message).toContain("position 1");
    expect(error.message).toContain("weight");
    expect(error.validationError.issues.length).toBeGreaterThan(0);
  });

  it("names the position when a corrupt entry has no id field", () => {
    const raw = [{ weight: -1 }];

    expect(() => loadAssets(widgetSchema, raw, "widgets")).toThrowError(/position 0/);
  });

  it("lets non-schema errors propagate unwrapped", () => {
    const throwingSchema = {
      safeParse(): never {
        throw new Error("boom");
      },
    } as unknown as z.ZodType<unknown>;

    expect(() => loadAssets(throwingSchema, [{}], "widgets")).toThrowError("boom");
  });
});
