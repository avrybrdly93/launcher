import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { loadProjectileAssets } from "./projectile-asset-loader.js";

describe("loadProjectileAssets", () => {
  it("loads the real asset fixtures unchanged", () => {
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toEqual(PROJECTILE_ASSETS);
  });

  it("rejects a corrupt fixture (negative mass), naming the fixture by id", () => {
    const corrupt = [
      ...PROJECTILE_ASSETS,
      { ...PROJECTILE_ASSETS[0]!, id: "broken-ball", mass: -1 },
    ];
    expect(() => loadProjectileAssets(corrupt)).toThrow(SchemaValidationError);
    expect(() => loadProjectileAssets(corrupt)).toThrow(/broken-ball/);
    expect(() => loadProjectileAssets(corrupt)).toThrow(/mass/);
  });

  it("rejects a fixture with no id at all, naming it by index", () => {
    const corrupt = [{ mass: 1 }];
    expect(() => loadProjectileAssets(corrupt)).toThrow(/index 0/);
  });

  it("rejects a fixture missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance["provenance"];
    expect(() => loadProjectileAssets([withoutProvenance])).toThrow(/provenance/);
  });
});
