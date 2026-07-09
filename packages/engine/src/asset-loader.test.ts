import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { loadProjectileAssets } from "./asset-loader.js";

const validAsset = {
  id: "test-ball",
  name: "Test ball",
  mass: 0.1,
  radius: 0.02,
  dragModel: { type: "constant", cd: 0.47 },
  provenance: "unit test fixture",
};

describe("loadProjectileAssets", () => {
  it("loads and validates a well-formed asset list", () => {
    const loaded = loadProjectileAssets([validAsset]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("test-ball");
  });

  it("rejects a corrupt fixture (negative mass) with a useful error identifying the index and field", () => {
    const corrupt = [validAsset, { ...validAsset, id: "broken-ball", mass: -5 }];
    expect(() => loadProjectileAssets(corrupt)).toThrow(SchemaValidationError);

    let caught: unknown;
    try {
      loadProjectileAssets(corrupt);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SchemaValidationError);
    expect((caught as Error).message).toContain("index 1");
    expect((caught as Error).message).toContain("mass");
  });

  it("rejects a corrupt fixture (missing provenance) with a useful error", () => {
    const withoutProvenance: Record<string, unknown> = { ...validAsset };
    delete withoutProvenance.provenance;
    expect(() => loadProjectileAssets([withoutProvenance])).toThrow(SchemaValidationError);
  });

  it("rejects duplicate ids across the asset list", () => {
    expect(() => loadProjectileAssets([validAsset, { ...validAsset }])).toThrow(
      /duplicate id "test-ball"/,
    );
  });

  it("rejects a completely malformed entry (not an object)", () => {
    expect(() => loadProjectileAssets(["not-an-object"])).toThrow(SchemaValidationError);
  });
});
