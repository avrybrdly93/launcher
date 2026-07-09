import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("has one asset each for sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      [
        "smooth-sphere",
        "golf-ball",
        "soccer-ball",
        "baseball",
        "table-tennis-ball",
        "cannonball",
        "shot-put",
      ].sort(),
    );
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const result = ProjectileSpecSchema.safeParse(asset);
      expect(result.success, `${asset.id}: ${!result.success ? result.error.message : ""}`).toBe(
        true,
      );
    }
  });

  it("every asset carries a non-empty provenance citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(20);
    }
  });

  it("rejects a corrupt asset (negative mass)", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(ProjectileSpecSchema.safeParse(corrupt).success).toBe(false);
  });

  it("rejects an asset missing a provenance string", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance.provenance;
    expect(ProjectileSpecSchema.safeParse(withoutProvenance).success).toBe(false);
  });
});
