import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { composeEnergyPower, mechanicalEnergy, mechanicalEnergyRate } from "./energy.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.001, -0.002],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("mechanicalEnergyRate vs composeEnergyPower", () => {
  it("dE/dt equals the sum of non-gravity forces' power exactly (algebraic identity, eq. 3.19)", () => {
    const gravity = new GravityForce();
    const drag = new QuadraticDragForce();
    const magnus = new MagnusForce();
    const forces = [gravity, drag, magnus];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);

      const dEdt = mechanicalEnergyRate(y, out, params.mass, ctx.env.g);
      const aeroPower = composeEnergyPower([drag, magnus], 0, y, ctx);

      expect(dEdt).toBeCloseTo(aeroPower, 10);
    }
  });

  it("drag off, aero forces off entirely: dE/dt is 0 to 1e-13 (gravity conserves E)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      const dEdt = mechanicalEnergyRate(y, out, params.mass, ctx.env.g);
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("drag off, Magnus only in still air: dE/dt is 0 to 1e-13 (F_M perp v)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new MagnusForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      const dEdt = mechanicalEnergyRate(y, out, params.mass, ctx.env.g);
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("drag on, still air: E is monotone non-increasing (dE/dt <= 0)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of STATES) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      const dEdt = mechanicalEnergyRate(y, out, params.mass, ctx.env.g);
      expect(dEdt).toBeLessThanOrEqual(1e-13);
    }
  });
});

describe("mechanicalEnergy", () => {
  it("matches a hand-computed value", () => {
    const y = new Float64Array([0, 10, 3, 4]);
    // 0.5*2*(9+16) + 2*9.8*10 = 25 + 196 = 221
    expect(mechanicalEnergy(y, 2, 9.8)).toBeCloseTo(221, 12);
  });
});

describe("createPlanarProjectileModel invariants", () => {
  it("declares an 'energy' InvariantSpec matching mechanicalEnergy", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const energyInvariant = model.invariants?.find((inv) => inv.name === "energy");
    expect(energyInvariant).toBeDefined();

    const y = new Float64Array([0, 100, 20, -5]);
    const value = energyInvariant!.evaluate(0, y, ctx);
    expect(value).toBeCloseTo(mechanicalEnergy(y, params.mass, ctx.env.g), 12);
  });
});
