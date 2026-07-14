import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  createForceRegistry,
  type ForceModel,
} from "./forces.js";
import { energyRateFromForces, mechanicalEnergy, nonGravityPower } from "./energy.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

function makeCtx(): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: new SaturatingLiftCoefficient(),
    spin: 180,
  });
  return createEvalContext(env, params);
}

describe("mechanicalEnergy", () => {
  it("is (1/2) m |v|^2 + m g y", () => {
    const y = new Float64Array([3, 10, 4, -3]);
    expect(mechanicalEnergy(y, 2, 9.8)).toBeCloseTo(0.5 * 2 * 25 + 2 * 9.8 * 10, 12);
  });
});

describe("energy invariant wiring (P1.24, eq. 3.19)", () => {
  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [0, 0.5, 0.05, -0.03],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
    [1, 1, 33.3, -12.7],
  ];

  it("drag-off: dE/dt from powers is 0 to 1e-13 (gravity alone)", () => {
    const forces = createForceRegistry([new GravityForce()]);
    const ctx = makeCtx();
    for (const state of states) {
      const y = new Float64Array(state);
      const kinematic = energyRateFromForces(forces, 0, y, ctx);
      const power = nonGravityPower(forces, 0, y, ctx);
      expect(kinematic).toBeCloseTo(0, 13);
      expect(power).toBe(0); // no non-gravity force registered: exact empty-sum zero
      expect(Math.abs(kinematic - power)).toBeLessThan(1e-13);
    }
  });

  it("kinematic dE/dt matches summed non-gravity energyPower to 1e-13 with drag+Magnus+buoyancy on", () => {
    const forces = createForceRegistry([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ]);
    const ctx = makeCtx();
    for (const state of states) {
      const y = new Float64Array(state);
      const kinematic = energyRateFromForces(forces, 0, y, ctx);
      const power = nonGravityPower(forces, 0, y, ctx);
      expect(kinematic).toBeCloseTo(power, 13);
    }
  });

  it("still air, drag on: dE/dt is non-positive (strict dissipation, eq. 3.19)", () => {
    const forces = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx();
    for (const state of states) {
      const y = new Float64Array(state);
      expect(energyRateFromForces(forces, 0, y, ctx)).toBeLessThanOrEqual(1e-13);
    }
  });

  it("Magnus alone (no drag) does no work: dE/dt is 0 to 1e-12", () => {
    const forces = createForceRegistry([new GravityForce(), new MagnusForce()]);
    const ctx = makeCtx();
    for (const state of states) {
      const y = new Float64Array(state);
      expect(energyRateFromForces(forces, 0, y, ctx)).toBeCloseTo(0, 11);
    }
  });

  it("createPlanarProjectileModel wires the energy invariant, matching mechanicalEnergy", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = makeCtx();
    const y = new Float64Array([0, 50, 20, -5]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx); // refreshes ctx.env
    expect(model.invariants).toHaveLength(1);
    const energy = model.invariants![0]!;
    expect(energy.name).toBe("energy");
    expect(energy.evaluate(0, y, ctx)).toBeCloseTo(
      mechanicalEnergy(y, ctx.params.mass, ctx.env.g),
      12,
    );
  });

  it("nonGravityPower ignores a force whose id is 'gravity' even if it isn't GravityForce", () => {
    const impostor: ForceModel = {
      id: "gravity",
      accumulate: (_t, _y, _ctx, out) => {
        out[1] += -100;
      },
      energyPower: () => 12345,
    };
    const ctx = makeCtx();
    const y = new Float64Array([0, 0, 1, 1]);
    expect(nonGravityPower(createForceRegistry([impostor]), 0, y, ctx)).toBe(0);
  });
});
