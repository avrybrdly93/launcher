import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { aeroPower, createEnergyInvariant, mechanicalEnergy } from "./energy.js";

const states: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 3.0, -2.0],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
];

describe("mechanicalEnergy", () => {
  it("matches the hand-computed E = 1/2 m|v|^2 + mgy", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    ctx.environment.sample(0, 0, 10, ctx.env);

    const y = new Float64Array([0, 10, 3, 4]);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * ctx.env.g * 10;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("aeroPower", () => {
  it("drag-off: dE/dt from powers is 0 to 1e-13 with gravity + Magnus alone (still air)", () => {
    const forces = [new GravityForce(), new MagnusForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0), // drag off
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx); // populates ctx.env / ctx.vRel at (0, y)
      expect(Math.abs(aeroPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("drag-off, aero-off: dE/dt from powers is exactly 0 with gravity alone", () => {
    const forces = [new GravityForce()];
    const model = createPlanarProjectileModel(forces);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(4);

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      expect(aeroPower(forces, 0, y, ctx)).toBe(0);
    }
  });

  it("drag-on, still air: dE/dt from powers is monotone non-increasing (<= 0)", () => {
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

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      expect(aeroPower(forces, 0, y, ctx)).toBeLessThanOrEqual(1e-13);
    }
  });
});

describe("createEnergyInvariant", () => {
  it("wires an 'energy' invariant onto the planar projectile model matching mechanicalEnergy", () => {
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
    const y = new Float64Array([0, 10, 20, 5]);
    model.rhs(0, y, out, ctx);

    const invariant = model.invariants?.find((i) => i.name === "energy");
    expect(invariant).toBeDefined();
    expect(invariant!.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(y, ctx), 12);
  });

  it("standalone invariant spec matches mechanicalEnergy directly", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    ctx.environment.sample(0, 0, 5, ctx.env);
    const y = new Float64Array([0, 5, 1, 2]);

    const invariant = createEnergyInvariant();
    expect(invariant.name).toBe("energy");
    expect(invariant.evaluate(0, y, ctx)).toBe(mechanicalEnergy(y, ctx));
  });
});
