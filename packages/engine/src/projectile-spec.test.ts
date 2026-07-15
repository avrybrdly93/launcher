import { describe, expect, it } from "vitest";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  resolveProjectileSpec,
  validateProjectileAssets,
} from "./projectile-spec.js";

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
  it("includes exactly the sphere/golf/soccer/baseball/TT/cannonball/shot-put roster (§3.9)", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const result = ProjectileSpecSchema.safeParse(asset);
      expect(result.success).toBe(true);
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("validateProjectileAssets returns the full roster without throwing", () => {
    expect(validateProjectileAssets()).toHaveLength(PROJECTILE_ASSETS.length);
  });

  it("rejects a corrupt asset (negative mass) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    const result = ProjectileSpecSchema.safeParse(corrupt);
    expect(result.success).toBe(false);
  });

  it("resolveProjectileSpec produces runtime ProjectileParams with matching mass/radius/area", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const params = resolveProjectileSpec(asset);
      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(1e4, 0)).toBeGreaterThan(0);
    }
  });

  it("resolves a lift coefficient only for assets that declare one (golf, baseball)", () => {
    const golf = resolveProjectileSpec(PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!);
    const sphere = resolveProjectileSpec(PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!);
    expect(golf.liftCoefficient).toBeDefined();
    expect(sphere.liftCoefficient).toBeUndefined();
  });

  it("the soccer-ball asset matches the mass/radius/Cd used in the P1.16 buoyancy validation fixture", () => {
    const soccer = PROJECTILE_ASSETS.find((a) => a.id === "soccer-ball")!;
    expect(soccer.mass).toBe(0.43);
    expect(soccer.radius).toBe(0.11);
    expect(soccer.dragCoefficient).toEqual({ kind: "constant", value: 0.25 });
  });

  it("the cannonball asset uses the tabulated-Reynolds drag model (high-Re flight regime)", () => {
    const cannonball = PROJECTILE_ASSETS.find((a) => a.id === "cannonball")!;
    expect(cannonball.dragCoefficient.kind).toBe("tabulatedReynolds");
  });
});
