import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { energyRateFromRhs, nonGravitationalPower } from "./energy.js";

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

describe("energy invariant (eq. 3.19)", () => {
  it("drag-off (gravity alone): dE/dt from powers is 0 to 1e-13", () => {
    const forces = [new GravityForce()];
    const model = createPlanarProjectileModel(forces);
    expect(model.invariants?.[0]?.name).toBe("energy");

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const [x, y, vx, vy] of STATES) {
      const state = new Float64Array([x, y, vx, vy]);
      model.rhs(0, state, out, ctx);

      const dEdtFromRhs = energyRateFromRhs(state, out, ctx);
      const dEdtFromPowers = nonGravitationalPower(forces, 0, state, ctx);

      expect(dEdtFromPowers).toBe(0);
      expect(Math.abs(dEdtFromRhs)).toBeLessThan(1e-13);
      expect(dEdtFromRhs).toBeCloseTo(dEdtFromPowers, 13);
    }
  });

  it("Magnus-only (no drag): dE/dt from powers is 0 to 1e-13 (lift does no work)", () => {
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
    const out = new Float64Array(4);

    for (const [x, y, vx, vy] of STATES) {
      const state = new Float64Array([x, y, vx, vy]);
      model.rhs(0, state, out, ctx);

      const dEdtFromRhs = energyRateFromRhs(state, out, ctx);
      const dEdtFromPowers = nonGravitationalPower(forces, 0, state, ctx);

      expect(Math.abs(dEdtFromPowers)).toBeLessThan(1e-10);
      expect(dEdtFromRhs).toBeCloseTo(dEdtFromPowers, 10);
    }
  });

  it("drag-on in still air: dE/dt matches the aero power sum and is non-positive (dissipative)", () => {
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const model = createPlanarProjectileModel(forces);

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const [x, y, vx, vy] of STATES) {
      const state = new Float64Array([x, y, vx, vy]);
      model.rhs(0, state, out, ctx);

      const dEdtFromRhs = energyRateFromRhs(state, out, ctx);
      const dEdtFromPowers = nonGravitationalPower(forces, 0, state, ctx);

      expect(dEdtFromRhs).toBeCloseTo(dEdtFromPowers, 10);
      expect(dEdtFromPowers).toBeLessThanOrEqual(0);
    }
  });
});
