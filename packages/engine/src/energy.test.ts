import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  createForceRegistry,
} from "./forces.js";
import { aeroEnergyPower, mechanicalEnergy } from "./energy.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.5, -0.7],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0.001],
  [0, 0, 0.001, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("mechanicalEnergy", () => {
  it("is attached to the model as an 'energy' invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");
  });

  it("matches (1/2)m|v|^2 + mgy by hand at a sample state", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    env.sample(0, 0, 10, ctx.env); // rhs samples the environment before reading ctx.env.g
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("aeroEnergyPower (eq. 3.19: dE/dt = F_aero . v)", () => {
  it("all aero off (gravity only): power is exactly 0", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce()]);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      env.sample(0, x, yPos, ctx.env);
      expect(aeroEnergyPower(forces, 0, y, ctx)).toBe(0);
    }
  });

  it("drag off, Magnus only (still air): dE/dt from powers === 0 to 1e-13", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce(), new MagnusForce()]);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      env.sample(0, x, yPos, ctx.env);
      ctx.vRel[0] = vx - ctx.env.wx;
      ctx.vRel[1] = vy - ctx.env.wy;
      ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);

      expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("drag on in still air: power is monotone non-increasing (<= 0)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);

    for (const [x, yPos, vx, vy] of STATES) {
      if (vx === 0 && vy === 0) continue;
      const y = new Float64Array([x, yPos, vx, vy]);
      env.sample(0, x, yPos, ctx.env);
      ctx.vRel[0] = vx - ctx.env.wx;
      ctx.vRel[1] = vy - ctx.env.wy;
      ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
      ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
      ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

      expect(aeroEnergyPower(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });

  it("excludes buoyancy's would-be-gravity-like id correctly (only literal 'gravity' id skipped)", () => {
    // Buoyancy is a constant force like gravity but is *not* folded into
    // mechanicalEnergy's potential term, so it must show up in aeroEnergyPower.
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const forces = createForceRegistry([new GravityForce(), new BuoyancyForce()]);
    const y = new Float64Array([0, 10, 0, -5]);
    env.sample(0, 0, 10, ctx.env);

    const power = aeroEnergyPower(forces, 0, y, ctx);
    expect(power).toBeCloseTo(ctx.env.rho * params.volume * ctx.env.g * -5, 12);
  });
});
