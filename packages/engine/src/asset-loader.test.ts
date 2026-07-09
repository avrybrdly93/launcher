import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AssetLoadError, loadAssets } from "./asset-loader.js";

const widgetSchema = z.object({
  id: z.string().min(1),
  weightKg: z.number().positive(),
});

describe("loadAssets", () => {
  it("returns validated records unchanged when every fixture is valid", () => {
    const raw = [
      { id: "a", weightKg: 1 },
      { id: "b", weightKg: 2.5 },
    ];
    expect(loadAssets(widgetSchema, raw, "widget")).toEqual(raw);
  });

  it("rejects a corrupt fixture with a useful error naming the asset and the bad field", () => {
    const raw = [
      { id: "a", weightKg: 1 },
      { id: "corrupt-widget", weightKg: -5 }, // negative weight fails schema
    ];

    let caught: unknown;
    try {
      loadAssets(widgetSchema, raw, "widget");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AssetLoadError);
    const error = caught as AssetLoadError;
    expect(error.message).toContain("widget");
    expect(error.message).toContain("#1");
    expect(error.message).toContain("corrupt-widget");
    expect(error.message).toContain("weightKg");
    expect(error.cause.issues.length).toBeGreaterThan(0);
  });

  it("identifies a corrupt fixture by index when it has no id field", () => {
    const raw = [{ weightKg: "not-a-number" }];

    expect(() => loadAssets(widgetSchema, raw, "widget")).toThrow(/widget #0/);
  });

  it("re-throws non-schema errors unchanged", () => {
    const throwingSchema = {
      safeParse: () => {
        throw new Error("boom");
      },
    } as unknown as z.ZodType<unknown>;

    expect(() => loadAssets(throwingSchema, [{}], "widget")).toThrow("boom");
  });
});
