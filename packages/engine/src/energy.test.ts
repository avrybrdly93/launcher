import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  composeEnergyPower,
  createForceRegistry,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { mechanicalEnergy, ENERGY_INVARIANT } from "./energy.js";

const VX = 2;
const VY = 3;

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

/** dE/dt via the chain rule, using rhs's acceleration directly (eq. 3.19's LHS, computed exactly). */
function chainRuleDEDt(mass: number, g: number, y: Float64Array, rhsOut: Float64Array): number {
  const vx = y[VX]!;
  const vy = y[VY]!;
  const ax = rhsOut[VX]!;
  const ay = rhsOut[VY]!;
  return mass * (vx * ax + vy * ay) + mass * g * vy;
}

describe("energy invariant wiring (eq. 3.19)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);
  const cl = new SaturatingLiftCoefficient();
  const spin = 180;

  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: cd,
    liftCoefficient: cl,
    spin,
  });

  it("drag-off: dE/dt from powers is exactly 0 (gravity alone)", () => {
    const forces: ForceModel[] = [new GravityForce()];
    const model = createPlanarProjectileModel(forces);
    const nonGravityForces = createForceRegistry(forces).filter((f) => f.id !== "gravity");

    for (const state of states) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      const ctx = createEvalContext(env, params);
      model.rhs(0, y, out, ctx);

      const power = composeEnergyPower(nonGravityForces, 0, y, ctx);
      expect(power).toBe(0);

      const dEdt = chainRuleDEDt(mass, ctx.env.g, y, out);
      expect(Math.abs(dEdt)).toBeLessThan(1e-13);
    }
  });

  it("drag/Magnus/buoyancy on: dE/dt from non-gravity powers matches the chain-rule dE/dt to 1e-13", () => {
    const forces: ForceModel[] = [
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ];
    const model = createPlanarProjectileModel(forces);
    const nonGravityForces = createForceRegistry(forces).filter((f) => f.id !== "gravity");

    for (const state of states) {
      const y = new Float64Array(state);
      const out = new Float64Array(4);
      const ctx = createEvalContext(env, params);
      model.rhs(0, y, out, ctx);

      const power = composeEnergyPower(nonGravityForces, 0, y, ctx);
      const dEdt = chainRuleDEDt(mass, ctx.env.g, y, out);
      expect(Math.abs(dEdt - power)).toBeLessThan(1e-13 * Math.max(1, Math.abs(dEdt)));
    }
  });

  it("still air, drag only: energy is monotone non-increasing (power <= 0)", () => {
    const forces: ForceModel[] = [new GravityForce(), new QuadraticDragForce()];
    const nonGravityForces = createForceRegistry(forces).filter((f) => f.id !== "gravity");

    for (const state of states) {
      const y = new Float64Array(state);
      const ctx = createEvalContext(env, params);
      env.sample(0, y[0]!, y[1]!, ctx.env);
      ctx.vRel[0] = y[VX]!;
      ctx.vRel[1] = y[VY]!;
      ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
      ctx.re = (ctx.env.rho * ctx.speedRel * (2 * radius)) / ctx.env.eta;
      ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;

      const power = composeEnergyPower(nonGravityForces, 0, y, ctx);
      expect(power).toBeLessThanOrEqual(0);
    }
  });

  it("ENERGY_INVARIANT reports mechanicalEnergy(y, mass, g)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const y = new Float64Array([0, 12.3, 10, -5]);
    const out = new Float64Array(4);
    const ctx = createEvalContext(env, params);
    model.rhs(0, y, out, ctx);

    expect(ENERGY_INVARIANT.evaluate(0, y, ctx)).toBeCloseTo(
      mechanicalEnergy(y, mass, ctx.env.g),
      15,
    );
  });
});
