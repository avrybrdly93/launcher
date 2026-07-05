import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { ISA, SUTHERLAND } from "./units.js";

describe("EvalContext derived channels (Re, Mach)", () => {
  it("matches a hand-computed Reynolds/Mach for a golf-ball drive to 1e-12", () => {
    // Golf ball: diameter 42.7 mm, driven at 70 m/s through ISA sea-level air.
    const radius = 0.02135;
    const speed = 70;
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.0459,
      radius,
      dragCoefficient: new ConstantCd(0.25),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, speed, 0]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);

    const diameter = 2 * radius;
    const expectedRe = (ISA.rho0 * speed * diameter) / SUTHERLAND.etaRef;
    const speedOfSound = Math.sqrt(1.4 * ISA.Rs * ISA.T0);
    const expectedMach = speed / speedOfSound;

    expect(Math.abs(ctx.re - expectedRe) / expectedRe).toBeLessThan(1e-12);
    expect(ctx.mach).toBeCloseTo(expectedMach, 12);
  });
});
