import { describe, expect, it } from "vitest";
import { loadProjectileAssets, loadProjectileSpec } from "./projectile-asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-spec.js";
import { SchemaValidationError } from "./schema.js";

describe("projectile asset loader (P1.26)", () => {
  it("loads every real asset without error", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(loadProjectileSpec(asset)).toEqual(asset);
    }
  });

  it("loads a batch of fixtures in order", () => {
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toEqual(PROJECTILE_ASSETS);
  });

  it("rejects a corrupt fixture (negative mass) with a useful, field-naming error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -5 };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    expect(() => loadProjectileSpec(corrupt)).toThrow(/mass/);

    let issueCount = -1;
    try {
      loadProjectileSpec(corrupt);
    } catch (err) {
      issueCount = (err as SchemaValidationError).issues.length;
    }
    expect(issueCount).toBeGreaterThan(0);
  });

  it("rejects a fixture missing provenance with a useful, field-naming error", () => {
    const corrupt: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete corrupt["provenance"];
    expect(() => loadProjectileSpec(corrupt)).toThrow(/provenance/);
  });

  it("rejects a malformed dragCoefficient discriminant", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, dragCoefficient: { type: "not-a-real-model" } };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
  });

  it("fails fast on the first corrupt entry in a batch load", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, radius: 0 };
    expect(() =>
      loadProjectileAssets([PROJECTILE_ASSETS[1]!, corrupt, PROJECTILE_ASSETS[2]!]),
    ).toThrow(SchemaValidationError);
  });
});
