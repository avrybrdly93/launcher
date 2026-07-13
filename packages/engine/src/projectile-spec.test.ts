import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import {
  loadProjectileAssets,
  parseProjectileSpec,
  ProjectileSpecSchema,
  PROJECTILE_ASSETS,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  const expectedIds = [
    "sphere",
    "golf",
    "soccer",
    "baseball",
    "tableTennis",
    "cannonball",
    "shotPut",
  ];

  it("has exactly the sphere/golf/soccer/baseball/TT/cannonball/shot-put assets", () => {
    expect(Object.keys(PROJECTILE_ASSETS).sort()).toEqual([...expectedIds].sort());
  });

  it("every asset validates against ProjectileSpecSchema and carries a non-empty provenance string", () => {
    for (const [key, asset] of Object.entries(PROJECTILE_ASSETS)) {
      const parsed = parseProjectileSpec(asset);
      expect(parsed).toEqual(asset);
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(10);
      expect(asset.id).toBe(key);
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("rejects a spec missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS.golf! };
    delete withoutProvenance.provenance;
    expect(() => parseProjectileSpec(withoutProvenance)).toThrow(SchemaValidationError);
  });

  it("rejects a spec with a non-positive mass", () => {
    const invalid = { ...PROJECTILE_ASSETS.baseball!, mass: 0 };
    expect(() => parseProjectileSpec(invalid)).toThrow(SchemaValidationError);
  });

  it("rejects an unknown dragCoefficient descriptor type", () => {
    const invalid = { ...PROJECTILE_ASSETS.sphere!, dragCoefficient: { type: "bogus" } };
    const result = ProjectileSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("spans a wide mass/radius range (low-Pi shot put to high-Pi table tennis, §3.9)", () => {
    expect(PROJECTILE_ASSETS.shotPut!.mass).toBeGreaterThan(
      PROJECTILE_ASSETS.tableTennis!.mass * 1000,
    );
  });
});

describe("loadProjectileAssets (P1.26)", () => {
  const validRaw = { golf: PROJECTILE_ASSETS.golf!, sphere: PROJECTILE_ASSETS.sphere! };

  it("loads a bundle of valid raw fixtures unchanged", () => {
    const loaded = loadProjectileAssets(validRaw);
    expect(loaded).toEqual(validRaw);
  });

  it("rejects a corrupt fixture with an error naming the offending asset key", () => {
    const corrupt = {
      golf: PROJECTILE_ASSETS.golf!,
      sphere: { ...PROJECTILE_ASSETS.sphere!, mass: "not-a-number" },
    };

    expect(() => loadProjectileAssets(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAssets(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).message).toContain('"sphere"');
      expect((err as SchemaValidationError).message).toContain("mass");
    }
  });

  it("rejects a fixture with an unknown drag-coefficient descriptor type, error mentions the asset key", () => {
    const corrupt = {
      baseball: { ...PROJECTILE_ASSETS.baseball!, dragCoefficient: { type: "warp-drive" } },
    };

    expect(() => loadProjectileAssets(corrupt)).toThrowError(/"baseball"/);
  });

  it("the real PROJECTILE_ASSETS bundle already passed load-time validation without throwing", () => {
    expect(() => loadProjectileAssets(PROJECTILE_ASSETS)).not.toThrow();
  });
});
