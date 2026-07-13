import { describe, expect, it } from "vitest";
import { loadProjectileAssets } from "./asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-spec.js";
import { SchemaValidationError } from "./schema.js";

describe("loadProjectileAssets", () => {
  it("loads the real asset catalog (build-time validation) without error", () => {
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toEqual(PROJECTILE_ASSETS);
  });

  it("rejects a corrupt fixture with a useful error naming the offending asset", () => {
    const corruptFixture: unknown[] = [
      PROJECTILE_ASSETS[0],
      { id: "bad-baseball", name: "Bad baseball", mass: -1, radius: 0.0366 }, // negative mass, no dragCoefficient/provenance
    ];

    let thrown: unknown;
    try {
      loadProjectileAssets(corruptFixture);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SchemaValidationError);
    const message = (thrown as SchemaValidationError).message;
    expect(message).toContain("bad-baseball");
    expect(message).toContain("index 1");
  });

  it("labels a corrupt fixture with no id by its index alone", () => {
    const corruptFixture: unknown[] = [{ mass: 1 }];
    expect(() => loadProjectileAssets(corruptFixture)).toThrow(/index 0/);
  });
});
