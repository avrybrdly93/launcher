import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createEnergyInvariant, energyRateFromPowers } from "./energy-invariant.js";

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

describe("energy invariant (eq. 3.19)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
  );

  it("drag-off: dE/dt from powers is exactly 0 to 1e-13 (gravity's power cancels the potential rate)", () => {
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(environment, params);
    const forces = [new GravityForce()];

    for (const state of states) {
      const y = new Float64Array(state);
      const rate = energyRateFromPowers(forces, 0, y, ctx);
      expect(Math.abs(rate)).toBeLessThan(1e-13);
    }
  });

  it("Magnus-only (still air): dE/dt from powers is 0 (ideal lift does no work)", () => {
    const cl = new SaturatingLiftCoefficient();
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(environment, params);
    const forces = [new GravityForce(), new MagnusForce()];

    for (const state of states) {
      const y = new Float64Array(state);
      const rate = energyRateFromPowers(forces, 0, y, ctx);
      expect(Math.abs(rate)).toBeLessThan(1e-10);
    }
  });

  it("drag-on in still air: dE/dt from powers is strictly non-positive", () => {
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(environment, params);
    const forces = [new GravityForce(), new QuadraticDragForce()];

    for (const state of states) {
      const y = new Float64Array(state);
      const rate = energyRateFromPowers(forces, 0, y, ctx);
      expect(rate).toBeLessThanOrEqual(1e-13);
    }
  });

  it("gravity+buoyancy (both constant, non-dissipative): dE/dt from powers equals buoyancy's power", () => {
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(environment, params);
    const buoyancy = new BuoyancyForce();
    const forces = [new GravityForce(), buoyancy];

    const y = new Float64Array([0, 0, 5, -3]);
    const rate = energyRateFromPowers(forces, 0, y, ctx);
    const expected = buoyancy.energyPower!(0, y, ctx);
    expect(rate).toBeCloseTo(expected, 12);
  });

  it("createPlanarProjectileModel wires the energy invariant into model.invariants", () => {
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = createEvalContext(environment, params);
    const invariant = model.invariants?.find((i) => i.name === "energy");
    expect(invariant).toBeDefined();

    const y = new Float64Array([0, 100, 20, 0]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);
    const expectedE = 0.5 * mass * (20 * 20 + 0 * 0) + mass * ctx.env.g * 100;
    expect(invariant!.evaluate(0, y, ctx)).toBeCloseTo(expectedE, 10);
  });

  it("createEnergyInvariant.evaluate matches (1/2)m|v|^2 + mgy directly", () => {
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(environment, params);
    ctx.env.g = 9.80665;
    const invariant = createEnergyInvariant();

    const y = new Float64Array([0, 42, 3, -4]);
    const expected = 0.5 * mass * (3 * 3 + -4 * -4) + mass * 9.80665 * 42;
    expect(invariant.evaluate(0, y, ctx)).toBeCloseTo(expected, 12);
  });
});
