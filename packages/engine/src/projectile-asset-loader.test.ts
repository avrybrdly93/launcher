import { describe, expect, it } from "vitest";
import { loadProjectileAsset, loadProjectileAssets } from "./projectile-asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

const VALID_ASSET = PROJECTILE_ASSETS[0]!;

describe("loadProjectileAsset", () => {
  it("parses a valid raw record", () => {
    expect(loadProjectileAsset(VALID_ASSET)).toEqual(VALID_ASSET);
  });

  it("rejects a corrupt fixture (negative mass) with a useful, path-qualified error", () => {
    const corrupt = { ...VALID_ASSET, mass: -1 };
    expect(() => loadProjectileAsset(corrupt)).toThrow(/mass/);
  });

  it("rejects a corrupt fixture (missing provenance) with a useful error", () => {
    const corrupt = Object.fromEntries(
      Object.entries(VALID_ASSET).filter(([key]) => key !== "provenance"),
    );
    expect(() => loadProjectileAsset(corrupt)).toThrow(/provenance/);
  });
});

describe("loadProjectileAssets", () => {
  it("parses a batch of valid raw records in order", () => {
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toEqual(PROJECTILE_ASSETS);
  });

  it("rejects a batch containing one corrupt fixture, naming its index and id", () => {
    const corrupt = { ...VALID_ASSET, radius: -0.05 };
    const batch = [PROJECTILE_ASSETS[1]!, corrupt, PROJECTILE_ASSETS[2]!];

    expect(() => loadProjectileAssets(batch)).toThrow(
      new RegExp(`index 1 \\(id: "${VALID_ASSET.id}"\\).*radius`, "s"),
    );
  });
});
