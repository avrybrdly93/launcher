import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { ProjectileSpecSchema, resolveProjectileParams } from "./projectile-spec.js";

describe("PROJECTILE_ASSETS (P1.25 validation)", () => {
  it("has 7 assets: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS).toHaveLength(7);
    const ids = PROJECTILE_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  it("every asset validates against ProjectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => ProjectileSpecSchema.parse(asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("resolves to usable ProjectileParams that produce finite forces (gravity+drag only)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const out = new Float64Array(4);

    for (const asset of PROJECTILE_ASSETS) {
      const params = resolveProjectileParams(asset);
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 20, 10]);
      model.rhs(0, y, out, ctx);

      for (let i = 0; i < 4; i++) {
        expect(Number.isFinite(out[i]!)).toBe(true);
      }
      // gravity + drag opposing upward motion: net vertical accel is downward
      expect(out[3]).toBeLessThan(0);
    }
  });

  it("resolves lift models to a working MagnusForce (finite forces, spin on)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const out = new Float64Array(4);

    for (const asset of PROJECTILE_ASSETS.filter((a) => a.liftModel)) {
      const params = resolveProjectileParams(asset, 100);
      const ctx = createEvalContext(env, params);
      const y = new Float64Array([0, 0, 20, 10]);
      model.rhs(0, y, out, ctx);

      for (let i = 0; i < 4; i++) {
        expect(Number.isFinite(out[i]!)).toBe(true);
      }
    }
  });
});
