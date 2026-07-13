import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { createForceRegistry, GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { aeroPower, mechanicalEnergy } from "./energy.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { norm } from "./vec2.js";

const STATES: readonly [number, number, number, number][] = [
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

/** Fills ctx.env/vRel/speedRel/re/mach, mirroring what planarProjectileModel.rhs does. */
function refreshDerived(ctx: EvalContext, env: Environment, t: number, y: Float64Array): void {
  env.sample(t, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
}

describe("mechanicalEnergy", () => {
  it("equals (1/2)m|v|^2 + mgy", () => {
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity());
    const ctx = createEvalContext(env, params);
    ctx.env.g = 9.80665;
    const y = new Float64Array([0, 12, 3, 4]);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * 9.80665 * 12;
    expect(mechanicalEnergy(y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("aeroPower (dE/dt via per-force energyPower, eq. 3.19)", () => {
  function buildContext(withLift: boolean): { ctx: EvalContext; env: Environment } {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: withLift ? new SaturatingLiftCoefficient() : undefined,
      spin: withLift ? 180 : undefined,
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    return { ctx, env };
  }

  it("is 0 to 1e-13 with drag off (gravity + ideal Magnus only, still air)", () => {
    const { ctx, env } = buildContext(true);
    const forces = createForceRegistry([new GravityForce(), new MagnusForce()]);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(aeroPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("is 0 to 1e-13 with gravity alone (no aero forces at all)", () => {
    const { ctx, env } = buildContext(false);
    const forces = createForceRegistry([new GravityForce()]);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(aeroPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("is <= 0 (dissipative) with drag on in still air", () => {
    const { ctx, env } = buildContext(false);
    const forces = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      refreshDerived(ctx, env, 0, y);
      expect(aeroPower(forces, 0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });
});

describe("createPlanarProjectileModel invariants wiring", () => {
  it("declares an 'energy' invariant matching mechanicalEnergy", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 10, 20, 5]);
    ctx.environment.sample(0, y[0]!, y[1]!, ctx.env);

    expect(model.invariants).toBeDefined();
    const energyInvariant = model.invariants!.find((inv) => inv.name === "energy");
    expect(energyInvariant).toBeDefined();
    expect(energyInvariant!.evaluate(0, y, ctx)).toBeCloseTo(mechanicalEnergy(y, ctx), 12);
  });
});
