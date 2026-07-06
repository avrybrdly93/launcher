import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import {
  createPlanarProjectileModel,
  energyDerivativeFromPowers,
} from "./planar-projectile-model.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.5, -0.8],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
];

describe("energy invariant (P1.24, eq. 3.19)", () => {
  it("model.invariants exposes E = 0.5*m*|v|^2 + m*g*y", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants).toHaveLength(1);
    const energy = model.invariants![0]!;
    expect(energy.name).toBe("energy");

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);
    const e = energy.evaluate(0, y, ctx);
    expect(e).toBeCloseTo(0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10, 12);
  });

  it("drag-off: dE/dt from powers is 0 to 1e-13 at 10 states", () => {
    const forces = [new GravityForce()];
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47), // unused: QuadraticDragForce isn't wired
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("ideal Magnus only: dE/dt from powers is 0 to 1e-13 (F_M perp v, still air)", () => {
    const forces = [new GravityForce(), new MagnusForce()];
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
      const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("drag on, still air: dE/dt from powers is <= 0 (strictly dissipative)", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
      expect(dEdt).toBeLessThanOrEqual(1e-13);
    }
  });

  it("buoyancy (a real non-conservative force) does register nonzero net power while rising", () => {
    const forces = [new GravityForce(), new BuoyancyForce()];
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.43,
      radius: 0.11,
      dragCoefficient: new ConstantCd(0.25),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 10]); // rising
    const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
    expect(dEdt).toBeGreaterThan(0);
  });

  it("dE/dt from powers matches the chain-rule derivative from rhs()", () => {
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
      const [, , vx, vy] = state;
      const [ax, ay] = [out[2]!, out[3]!];
      const chainRuleDEdt =
        ctx.params.mass * (vx! * ax + vy! * ay) + ctx.params.mass * ctx.env.g * vy!;

      const dEdt = energyDerivativeFromPowers(forces, 0, y, ctx);
      expect(Math.abs(dEdt - chainRuleDEdt)).toBeLessThan(1e-10);
    }
  });
});
