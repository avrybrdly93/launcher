import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { createForceRegistry, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  createEnergyInvariant,
  MECHANICAL_ENERGY_INVARIANT,
  nonGravityPower,
} from "./energy-invariant.js";

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

describe("energy invariant", () => {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());

  it("E(y) matches (1/2)m|v|^2 + mgy by hand", () => {
    const mass = 0.145;
    const params = createSphericalProjectileParams({
      mass,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const invariant = createEnergyInvariant();

    for (const [x, yPos, vx, vy] of states) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const expected = 0.5 * mass * (vx * vx + vy * vy) + mass * ctx.env.g * yPos;
      expect(invariant.evaluate(0, y, ctx)).toBeCloseTo(expected, 10);
    }
  });

  it("createPlanarProjectileModel wires the energy invariant into model.invariants", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.map((inv) => inv.name)).toEqual([MECHANICAL_ENERGY_INVARIANT]);
  });

  it("drag-off (gravity alone): dE/dt from powers is exactly 0", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const gravityForces = [new GravityForce()];
    const forces = createForceRegistry(gravityForces);
    const model = createPlanarProjectileModel(gravityForces);
    const out = new Float64Array(4);

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx); // refresh ctx.vRel/speedRel/re/mach for (t, y)
      expect(nonGravityPower(forces, 0, y, ctx)).toBe(0);
    }
  });

  it("drag-off (gravity+Magnus, still air): dE/dt from powers is 0 to 1e-13", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const gravityMagnusForces = [new GravityForce(), new MagnusForce()];
    const forces = createForceRegistry(gravityMagnusForces);
    const model = createPlanarProjectileModel(gravityMagnusForces);
    const out = new Float64Array(4);

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      expect(Math.abs(nonGravityPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("drag-on in still air: dE/dt from powers is strictly non-positive (dissipative)", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const dragForces = [new GravityForce(), new QuadraticDragForce()];
    const forces = createForceRegistry(dragForces);
    const model = createPlanarProjectileModel(dragForces);
    const out = new Float64Array(4);

    for (const state of states) {
      const y = new Float64Array(state);
      model.rhs(0, y, out, ctx);
      const [, , vx, vy] = state;
      const power = nonGravityPower(forces, 0, y, ctx);
      if (vx === 0 && vy === 0) {
        expect(power).toBe(0);
      } else {
        expect(power).toBeLessThan(0);
      }
    }
  });
});
