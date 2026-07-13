import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { BuoyancyForce, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { energyRateFromPowers, mechanicalEnergy } from "./energy.js";

function makeCtx(overrides: { spin?: number; withLift?: boolean } = {}) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: overrides.withLift ? new SaturatingLiftCoefficient() : undefined,
    spin: overrides.spin,
  });
  return { ctx: createEvalContext(env, params), env, params };
}

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [100, 10, -1.5, -1.5],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
];

describe("mechanicalEnergy", () => {
  it("is 1/2 m|v|^2 + mgy", () => {
    const { ctx } = makeCtx();
    const y = new Float64Array([0, 50, 30, -10]);
    const e = mechanicalEnergy(0, y, ctx);
    const expected = 0.5 * ctx.params.mass * (30 * 30 + 10 * 10) + ctx.params.mass * ctx.env.g * 50;
    expect(e).toBeCloseTo(expected, 12);
  });
});

describe("createPlanarProjectileModel invariants", () => {
  it("exposes the energy invariant spec", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants).toHaveLength(1);
    expect(model.invariants![0]!.name).toBe("energy");
  });
});

describe("energyRateFromPowers (eq. 3.19)", () => {
  it("drag-off: dE/dt from powers is 0 to 1e-13 at 10 states", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce()];

    for (const state of STATES) {
      const y = new Float64Array(state);
      expect(Math.abs(energyRateFromPowers(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("Magnus-only: dE/dt from powers is ~0 (ideal Magnus does no work)", () => {
    const { ctx } = makeCtx({ spin: 200, withLift: true });
    const forces = [new GravityForce(), new MagnusForce()];

    for (const state of STATES) {
      const y = new Float64Array(state);
      expect(Math.abs(energyRateFromPowers(forces, 0, y, ctx))).toBeLessThan(1e-10);
    }
  });

  it("drag-on in still air: dE/dt is monotone non-increasing (<=0)", () => {
    const { ctx } = makeCtx();
    const forces = [new GravityForce(), new QuadraticDragForce()];

    for (const state of STATES) {
      const y = new Float64Array(state);
      expect(energyRateFromPowers(forces, 0, y, ctx)).toBeLessThanOrEqual(1e-13);
    }
  });

  it("drag-on in still air matches the closed form -0.5*rho*Cd*A*|v|^3", () => {
    const { ctx, params } = makeCtx();
    const forces = [new GravityForce(), new QuadraticDragForce()];
    const cd = params.dragCoefficient.cd(0, 0);
    const rho = 1.225; // ConstantAtmosphere ISA sea-level density

    for (const state of STATES) {
      const y = new Float64Array(state);
      const speed = Math.hypot(y[2]!, y[3]!);
      const expectedDeDt = -0.5 * rho * cd * params.area * speed * speed * speed;
      expect(energyRateFromPowers(forces, 0, y, ctx)).toBeCloseTo(expectedDeDt, 9);
    }
  });

  it("gravity+buoyancy (no drag): dE/dt is NOT zero (buoyancy work is not cancelled by E's mgy term)", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    const forces = [new GravityForce(), new BuoyancyForce()];

    const y = new Float64Array([0, 0, 10, 5]);
    const rate = energyRateFromPowers(forces, 0, y, ctx);
    const expected = ctx.env.rho * params.volume * ctx.env.g * y[3]!;
    expect(rate).toBeCloseTo(expected, 12);
    expect(Math.abs(rate)).toBeGreaterThan(1e-6);
  });
});
