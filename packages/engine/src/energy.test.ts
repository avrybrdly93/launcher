import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { aeroEnergyPower, energyDerivativeFromRhs, mechanicalEnergy } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 3.2, -4.4],
  [100, 10, -1.5, -6.5],
  [0, 0, 40, 0.1],
  [0, 0, 0.1, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("energy invariant (eq. 3.19)", () => {
  it("wires an 'energy' InvariantSpec onto the planar projectile model", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    const e = model.invariants![0]!.evaluate(0, y, ctx);
    expect(e).toBeCloseTo(0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10, 10);
  });

  it("drag-off (gravity only): dE/dt from powers is exactly 0 to 1e-13", () => {
    const forces = [new GravityForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
      expect(Math.abs(energyDerivativeFromRhs(y, out, ctx))).toBeLessThan(1e-13);
    }
  });

  it("Magnus-only, still air: E is conserved (F_M is perp to v_rel, power = 0)", () => {
    const forces = [new GravityForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-10);
      expect(Math.abs(energyDerivativeFromRhs(y, out, ctx))).toBeLessThan(1e-10);
    }
  });

  it("drag on, still air: E is monotone non-increasing (aero power <= 0)", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      const power = aeroEnergyPower(forces, 0, y, ctx);
      expect(power).toBeLessThanOrEqual(1e-15);
      expect(energyDerivativeFromRhs(y, out, ctx)).toBeCloseTo(power, 10);
    }
  });

  it("mechanicalEnergy matches a hand-computed value", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 50, ctx.env);
    const y = new Float64Array([0, 50, 6, 8]);
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(0.5 * (6 * 6 + 8 * 8) + ctx.env.g * 50, 12);
  });
});
