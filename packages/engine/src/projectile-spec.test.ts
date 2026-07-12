import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS, ProjectileSpecSchema } from "./projectile-spec.js";

describe("ProjectileSpec assets (P1.25)", () => {
  it("ships exactly the seven required initial assets", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id).sort();
    expect(ids).toEqual(
      [
        "baseball",
        "cannonball",
        "golf-ball",
        "shot-put",
        "smooth-sphere",
        "soccer-ball",
        "table-tennis-ball",
      ].sort(),
    );
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset carries a non-empty provenance citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.provenance.length).toBeGreaterThan(10);
    }
  });

  it("every asset has positive mass and radius", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass).toBeGreaterThan(0);
      expect(asset.radius).toBeGreaterThan(0);
    }
  });

  it("rejects a spec with non-positive mass", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0], mass: -1 };
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
  });

  it("rejects a spec missing provenance", () => {
    const corrupt: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete corrupt["provenance"];
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
  });

  it("cannonball mass is derived from a 0.1 m iron sphere (~4.1 kg)", () => {
    const cannonball = PROJECTILE_ASSETS.find((a) => a.id === "cannonball")!;
    expect(cannonball.radius).toBeCloseTo(0.05, 10);
    expect(cannonball.mass).toBeGreaterThan(4.0);
    expect(cannonball.mass).toBeLessThan(4.3);
  });
});
