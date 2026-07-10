import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { parseProjectileSpec, projectileParamsFromSpec } from "./projectile-spec.js";

const EXPECTED_IDS = [
  "smooth-sphere",
  "golf-ball",
  "soccer-ball",
  "baseball",
  "table-tennis-ball",
  "cannonball",
  "shot-put",
];

describe("PROJECTILE_ASSETS", () => {
  it("validates all 7 initial assets (sphere, golf, soccer, baseball, TT ball, cannonball, shot put)", () => {
    expect(PROJECTILE_ASSETS.map((spec) => spec.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every asset carries a non-empty provenance citation", () => {
    for (const spec of PROJECTILE_ASSETS) {
      expect(spec.provenance.length).toBeGreaterThan(10);
    }
  });

  it("every asset has physically sane mass/radius (positive, sub-10kg, sub-20cm radius)", () => {
    for (const spec of PROJECTILE_ASSETS) {
      expect(spec.mass).toBeGreaterThan(0);
      expect(spec.mass).toBeLessThan(10);
      expect(spec.radius).toBeGreaterThan(0);
      expect(spec.radius).toBeLessThan(0.2);
    }
  });

  it("every asset converts to usable ProjectileParams", () => {
    for (const spec of PROJECTILE_ASSETS) {
      const params = projectileParamsFromSpec(spec);
      expect(params.mass).toBe(spec.mass);
      expect(params.radius).toBe(spec.radius);
      expect(params.area).toBeCloseTo(Math.PI * spec.radius * spec.radius, 12);
      expect(params.dragCoefficient.cd(1e5, 0)).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt spec (missing provenance)", () => {
    expect(() =>
      parseProjectileSpec({
        id: "bad",
        name: "Bad",
        mass: 1,
        radius: 0.1,
        dragCoefficient: { kind: "constant", cd: 0.47 },
      }),
    ).toThrow();
  });

  it("rejects a spec with non-positive mass", () => {
    expect(() =>
      parseProjectileSpec({
        id: "bad",
        name: "Bad",
        mass: -1,
        radius: 0.1,
        dragCoefficient: { kind: "constant", cd: 0.47 },
        provenance: "n/a",
      }),
    ).toThrow();
  });
});
