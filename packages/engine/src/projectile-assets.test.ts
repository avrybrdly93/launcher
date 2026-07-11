import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS, PROJECTILE_ASSETS_BY_ID } from "./projectile-assets.js";
import { resolveProjectileSpec } from "./projectile-spec.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball-0.1m-iron",
  "shot-put",
];

describe("PROJECTILE_ASSETS", () => {
  it("has exactly the initial asset roster (§3.9): sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS.map((spec) => spec.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every asset already validated at module load (parseProjectileSpec) and carries a provenance string", () => {
    for (const spec of PROJECTILE_ASSETS) {
      expect(spec.provenance.length).toBeGreaterThan(0);
      expect(spec.mass).toBeGreaterThan(0);
      expect(spec.radius).toBeGreaterThan(0);
    }
  });

  it("every asset resolves to usable runtime ProjectileParams", () => {
    for (const spec of PROJECTILE_ASSETS) {
      const params = resolveProjectileSpec(spec);
      expect(params.mass).toBe(spec.mass);
      expect(params.radius).toBe(spec.radius);
      expect(params.area).toBeGreaterThan(0);
      expect(params.volume).toBeGreaterThan(0);
      expect(Number.isFinite(params.dragCoefficient.cd(1e5, 0.1))).toBe(true);
    }
  });

  it("is indexed by id for scenario lookup", () => {
    for (const id of EXPECTED_IDS) {
      expect(PROJECTILE_ASSETS_BY_ID.get(id)?.id).toBe(id);
    }
    expect(PROJECTILE_ASSETS_BY_ID.get("does-not-exist")).toBeUndefined();
  });
});
