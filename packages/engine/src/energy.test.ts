import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { aeroEnergyPower, mechanicalEnergy } from "./energy.js";

describe("mechanicalEnergy", () => {
  it("matches the hand-computed E = (1/2)m|v|^2 + mgy", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const mass = 0.145;
    const params = createSphericalProjectileParams({
      mass,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([3, 10, 20, -5]);
    const g = 9.80665;
    const expected = 0.5 * mass * (20 * 20 + 5 * 5) + mass * g * 10;
    expect(mechanicalEnergy(0, y, ctx)).toBeCloseTo(expected, 10);
  });
});

describe("aeroEnergyPower", () => {
  it("drag off: is exactly 0 at 10 random states (gravity is the only registered force)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce()];

    const states: [number, number, number, number][] = [
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

    for (const state of states) {
      const y = new Float64Array(state);
      expect(aeroEnergyPower(forces, 0, y, ctx)).toBe(0);
    }
  });

  it("drag alone in still air is strictly dissipative (power <= 0) for any nonzero v", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce(), new QuadraticDragForce()];

    const velocities: [number, number][] = [
      [12.3, 4.1],
      [-8.2, 15.6],
      [25.0, -30.1],
      [40, 0],
      [0, -40],
      [-5, -5],
    ];

    for (const [vx, vy] of velocities) {
      const y = new Float64Array([0, 50, vx, vy]);
      expect(aeroEnergyPower(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });

  it("Magnus alone in still air does no work (power ~= 0, F_M perp v)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce(), new MagnusForce()];

    const velocities: [number, number][] = [
      [12.3, 4.1],
      [-8.2, 15.6],
      [25.0, -30.1],
      [40, 0],
      [0, -40],
    ];

    for (const [vx, vy] of velocities) {
      const y = new Float64Array([0, 50, vx, vy]);
      expect(aeroEnergyPower(forces, 0, y, ctx)).toBeCloseTo(0, 10);
    }
  });
});
