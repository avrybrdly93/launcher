import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  PROJECTILE_ASSETS,
  projectileParamsFromSpec,
  projectileSpecSchema,
  validateProjectileAssets,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers sphere, golf, soccer, baseball, table-tennis, cannonball, shot-put", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      ["baseball", "cannonball", "golf", "shot-put", "soccer", "sphere", "table-tennis"].sort(),
    );
  });

  it("every asset validates against projectileSpecSchema", () => {
    expect(() => validateProjectileAssets()).not.toThrow();
    for (const asset of PROJECTILE_ASSETS) {
      expect(projectileSpecSchema.safeParse(asset).success).toBe(true);
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(20);
    }
  });

  it("rejects a spec with a non-positive mass", () => {
    const invalid = { ...PROJECTILE_ASSETS[0]!, mass: 0 };
    expect(projectileSpecSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a spec with an empty provenance string", () => {
    const invalid = { ...PROJECTILE_ASSETS[0]!, provenance: "" };
    expect(projectileSpecSchema.safeParse(invalid).success).toBe(false);
  });

  it("resolves into ProjectileParams the engine can actually integrate", () => {
    const baseball = PROJECTILE_ASSETS.find((a) => a.id === "baseball")!;
    const params = projectileParamsFromSpec(baseball);
    expect(params.mass).toBe(baseball.mass);
    expect(params.radius).toBe(baseball.radius);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.35);
    expect(params.liftCoefficient).toBeDefined();

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 1, 30, 10]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);
    expect(Number.isFinite(out[2])).toBe(true);
    expect(Number.isFinite(out[3])).toBe(true);
  });
});
