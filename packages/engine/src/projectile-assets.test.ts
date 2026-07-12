import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("includes exactly the seven Phase-1 presets (§3.9)", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      ["baseball", "cannonball", "golf", "shot-put", "soccer", "sphere", "table-tennis"].sort(),
    );
  });

  it("validates against ProjectileSpecSchema and carries a non-empty provenance string", () => {
    expect(PROJECTILE_ASSETS.length).toBeGreaterThan(0);
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
      expect(asset.provenance.length).toBeGreaterThan(0);
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt asset (negative mass, missing provenance)", () => {
    const corruptMass = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(() => ProjectileSpecSchema.parse(corruptMass)).toThrow();

    const withoutProvenance = Object.fromEntries(
      Object.entries(PROJECTILE_ASSETS[0]!).filter(([key]) => key !== "provenance"),
    );
    expect(() => ProjectileSpecSchema.parse(withoutProvenance)).toThrow();
  });
});
