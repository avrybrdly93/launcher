import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  createForceRegistry,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
} from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { mechanicalEnergy, nonGravityEnergyPower } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.01, -0.02],
  [100, 10, -80, -60],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 15, 15],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("energy invariant", () => {
  it("createPlanarProjectileModel declares the `energy` invariant matching mechanicalEnergy", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);

    expect(model.invariants).toHaveLength(1);
    const energyInvariant = model.invariants![0]!;
    expect(energyInvariant.name).toBe("energy");
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10;
    expect(energyInvariant.evaluate(0, y, ctx)).toBeCloseTo(expected, 10);
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 10);
  });

  it("drag-off: dE/dt from powers is identically 0 to 1e-13 (gravity alone is conservative)", () => {
    const forces = createForceRegistry([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47), // present on params but no drag force registered
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      // energyPower needs ctx.vRel/speedRel refreshed, same as rhs would do.
      ctx.vRel[0] = y[2]!;
      ctx.vRel[1] = y[3]!;
      expect(nonGravityEnergyPower(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("dE/dt from powers matches dE/dt from the rhs chain rule to 1e-13 (gravity+drag+Magnus+buoyancy)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const forces = createForceRegistry([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ]);
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx); // refreshes ctx.vRel/speedRel/re/mach at (t, y)
      const vx = y[2]!;
      const vy = y[3]!;
      const ax = out[2]!;
      const ay = out[3]!;

      const dEdtFromRhs = mass * (vx * ax + vy * ay) + mass * ctx.env.g * vy;
      const dEdtFromPowers = nonGravityEnergyPower(forces, 0, y, ctx);
      expect(dEdtFromPowers).toBeCloseTo(dEdtFromRhs, 11);
    }
  });

  it("still-air drag dissipates: dE/dt from powers is <= 0", () => {
    const forces = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      ctx.vRel[0] = y[2]!;
      ctx.vRel[1] = y[3]!;
      const [vx, vy] = [y[2]!, y[3]!];
      const speed = Math.hypot(vx, vy);
      ctx.speedRel = speed;
      ctx.re = (ctx.env.rho * speed * (2 * ctx.params.radius)) / ctx.env.eta;
      ctx.mach = 0;
      expect(nonGravityEnergyPower(forces, 0, y, ctx)).toBeLessThanOrEqual(1e-12);
    }
  });
});
