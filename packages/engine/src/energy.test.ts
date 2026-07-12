import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { composeEnergyPower, mechanicalEnergy } from "./energy.js";

describe("mechanicalEnergy", () => {
  it("computes E = 1/2 m|v|^2 + mgy", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 3, 4]);

    const g = 9.80665;
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * g * 10;
    expect(mechanicalEnergy(0, y, ctx)).toBeCloseTo(expected, 12);
  });

  it("is wired as the planar model's declared invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.[0]?.name).toBe("mechanicalEnergy");
  });
});

describe("composeEnergyPower / energy invariant (eq. 3.19)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const spin = 180;
  const cd = new ConstantCd(0.47);
  const cl = new SaturatingLiftCoefficient();

  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: cd,
    liftCoefficient: cl,
    spin,
  });

  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
    [1, 1, 33.3, -12.7],
  ];

  it("drag-off: dE/dt from powers is 0 to 1e-13 (gravity's power cancels d(mgy)/dt, Magnus does no work)", () => {
    const gravity = new GravityForce();
    const magnus = new MagnusForce();
    const forces = [gravity, magnus];
    const model = createPlanarProjectileModel(forces);
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      const vx = y[2]!;
      const vy = y[3]!;
      const ax = out[2]!;
      const ay = out[3]!;

      // dE/dt computed directly by differentiating E = 1/2 m|v|^2 + mgy along the dynamics.
      const dEdtFromDerivative = mass * (vx * ax + vy * ay) + mass * ctx.env.g * vy;

      // dE/dt per eq. (3.19): sum of energyPower over every force except gravity.
      const aeroForces = forces.filter((f) => f.id !== "gravity");
      const dEdtFromPowers = composeEnergyPower(aeroForces, 0, y, ctx);

      expect(Math.abs(dEdtFromDerivative)).toBeLessThan(1e-13);
      expect(Math.abs(dEdtFromPowers)).toBeLessThan(1e-13);
      expect(Math.abs(dEdtFromDerivative - dEdtFromPowers)).toBeLessThan(1e-13);
    }
  });

  it("gravity alone (no Magnus, no drag): dE/dt from powers is exactly 0", () => {
    const forces = [new GravityForce()];
    const ctx = createEvalContext(env, params);

    for (const state of states) {
      const y = new Float64Array(state);
      const dEdtFromPowers = composeEnergyPower(
        forces.filter((f) => f.id !== "gravity"),
        0,
        y,
        ctx,
      );
      expect(dEdtFromPowers).toBe(0);
    }
  });
});
