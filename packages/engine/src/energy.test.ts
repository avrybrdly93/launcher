import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createEnergyRateInvariant, mechanicalEnergy } from "./energy.js";

describe("mechanicalEnergy", () => {
  it("matches (1/2)m|v|^2 + mgy at a hand-computed state", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);
    const out = new Float64Array(4);
    const y = new Float64Array([0, 10, 3, 4]); // |v| = 5
    model.rhs(0, y, out, ctx); // populate ctx.env

    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("createEnergyRateInvariant", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);
  const cl = new SaturatingLiftCoefficient();
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());

  it("drag off (gravity + Magnus in still air): dE/dt from powers is 0 to 1e-13", () => {
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin: 180,
    });
    const forces = [new GravityForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const energyRate = createEnergyRateInvariant([forces[1]!]); // aero subset: Magnus only

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [0, 0, 0.001, -0.002],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const ctx = createEvalContext(env, params);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx); // populate ctx.vRel/speedRel/re/mach

      expect(Math.abs(energyRate.evaluate(0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("no aero forces registered: dE/dt from powers is exactly 0", () => {
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const model = createPlanarProjectileModel([new GravityForce()]);
    const energyRate = createEnergyRateInvariant([]);

    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 100, 20, -5]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);

    expect(energyRate.evaluate(0, y, ctx)).toBe(0);
  });

  it("quadratic drag in still air: dE/dt matches -0.5*rho*Cd*A*|v|^3 (§3.8/3.19)", () => {
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const area = Math.PI * radius * radius;
    const rho = 1.225;
    const dragForce = new QuadraticDragForce();
    const model = createPlanarProjectileModel([new GravityForce(), dragForce]);
    const energyRate = createEnergyRateInvariant([dragForce]);

    const states: [number, number, number, number][] = [
      [0, 0, 20, 0],
      [0, 0, -12, 9],
      [0, 0, 3, -4],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const ctx = createEvalContext(env, params);
      const out = new Float64Array(4);
      model.rhs(0, y, out, ctx);

      const speed = Math.hypot(state[2], state[3]);
      const expected = -0.5 * rho * cd.cd(0, 0) * area * speed ** 3;
      expect(energyRate.evaluate(0, y, ctx)).toBeCloseTo(expected, 9);
      expect(energyRate.evaluate(0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });
});
