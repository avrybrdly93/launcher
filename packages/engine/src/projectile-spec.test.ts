import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS, ProjectileSpecSchema } from "./projectile-spec.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball-iron-0.1m",
  "shot-put",
];

describe("PROJECTILE_ASSETS", () => {
  it("covers sphere/golf/soccer/baseball/TT/cannonball/shot-put", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("has unique ids", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string (validation criterion)", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(20);
    }
  });

  it("rejects an asset missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance["provenance"];
    expect(() => ProjectileSpecSchema.parse(withoutProvenance)).toThrow();
  });

  it("rejects non-positive mass/radius", () => {
    const base = PROJECTILE_ASSETS[0]!;
    expect(() => ProjectileSpecSchema.parse({ ...base, mass: 0 })).toThrow();
    expect(() => ProjectileSpecSchema.parse({ ...base, radius: -1 })).toThrow();
  });
});
