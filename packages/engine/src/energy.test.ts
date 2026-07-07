import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import {
  BuoyancyForce,
  createForceRegistry,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  type ForceModel,
} from "./forces.js";
import { aeroEnergyPower, createEnergyInvariant } from "./energy.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { norm } from "./vec2.js";

function makeContext(overrides: { spin?: number; withLift?: boolean } = {}): {
  ctx: EvalContext;
  env: Environment;
} {
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: overrides.withLift ? new SaturatingLiftCoefficient() : undefined,
    spin: overrides.spin,
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const ctx = createEvalContext(env, params);
  return { ctx, env };
}

/** Fills ctx.env/vRel/speedRel/re/mach the same way planarProjectileModel.rhs would. */
function refreshDerived(ctx: EvalContext, env: Environment, t: number, y: Float64Array): void {
  env.sample(t, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

describe("createEnergyInvariant (P1.24)", () => {
  it("evaluates E = (1/2)m|v|^2 + mgy", () => {
    const { ctx, env } = makeContext();
    const y = new Float64Array([0, 100, 3, -4]);
    refreshDerived(ctx, env, 0, y);
    const invariant = createEnergyInvariant();
    expect(invariant.name).toBe("energy");
    const expected = 0.5 * ctx.params.mass * (9 + 16) + ctx.params.mass * ctx.env.g * 100;
    expect(invariant.evaluate(0, y, ctx)).toBeCloseTo(expected, 12);
  });

  it("is wired onto createPlanarProjectileModel", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");
  });
});

describe("aeroEnergyPower (P1.24 / eq. 3.19)", () => {
  it("is exactly 0 with drag off (gravity only) — the task's validation criterion", () => {
    const { ctx, env } = makeContext();
    const forces = createForceRegistry([new GravityForce()]);
    for (const [vx, vy] of [
      [12, 3],
      [0, -30],
      [-5, 20],
    ] as const) {
      const y = new Float64Array([0, 50, vx, vy]);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("is exactly 0 with Magnus alone in still air (F_M perp v)", () => {
    const { ctx, env } = makeContext({ spin: 180, withLift: true });
    const forces = createForceRegistry([new GravityForce(), new MagnusForce()]);
    for (const [vx, vy] of [
      [25, 10],
      [-8, 15],
      [30, 0],
    ] as const) {
      const y = new Float64Array([0, 10, vx, vy]);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-12);
    }
  });

  it("is <= 0 with drag on in still air and matches -0.5*rho*Cd*A*u^3 (dissipation, eq. 3.19)", () => {
    const { ctx, env } = makeContext();
    const forces = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);
    for (const [vx, vy] of [
      [20, 0],
      [0, -25],
      [15, 15],
      [-10, 5],
    ] as const) {
      const y = new Float64Array([0, 10, vx, vy]);
      refreshDerived(ctx, env, 0, y);
      const power = aeroEnergyPower(forces, 0, y, ctx);
      expect(power).toBeLessThanOrEqual(0);
      const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
      const u = ctx.speedRel;
      const expected = -0.5 * ctx.env.rho * cd * ctx.params.area * u * u * u;
      expect(power).toBeCloseTo(expected, 10);
    }
  });

  it("excludes buoyancy's power too, treating it as non-gravity (it isn't folded into E's potential term)", () => {
    const { ctx, env } = makeContext();
    const forces = createForceRegistry([new GravityForce(), new BuoyancyForce()]);
    const y = new Float64Array([0, 10, 5, -3]);
    refreshDerived(ctx, env, 0, y);
    const expected = ctx.env.rho * ctx.params.volume * ctx.env.g * y[3]!;
    expect(aeroEnergyPower(forces, 0, y, ctx)).toBeCloseTo(expected, 14);
  });
});

describe("dE/dt consistency: gradient-of-E . rhs equals mg*vy + total registered energyPower", () => {
  it("holds to 1e-13 for an arbitrary force composition at several states", () => {
    const { ctx } = makeContext({ spin: 150, withLift: true });
    const forceList: ForceModel[] = [
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
      new BuoyancyForce(),
    ];
    const forces = createForceRegistry(forceList);
    const model = createPlanarProjectileModel(forceList);
    const out = new Float64Array(4);

    for (const [vx, vy] of [
      [18, -6],
      [40, 0],
      [-12, 22],
    ] as const) {
      const y = new Float64Array([0, 30, vx, vy]);
      model.rhs(0, y, out, ctx); // refreshes ctx.env at (0, 30) and fills out = f(t,y)

      // dE/dt = grad(E) . f, with grad(E) = (0, mg, m*vx, m*vy).
      const dEdt =
        ctx.params.mass * ctx.env.g * out[1]! + ctx.params.mass * (vx * out[2]! + vy * out[3]!);

      let totalPower = 0;
      for (const force of forces) totalPower += force.energyPower!(0, y, ctx);
      const reconstructed = ctx.params.mass * ctx.env.g * vy + totalPower;

      expect(Math.abs(dEdt - reconstructed)).toBeLessThan(1e-13);
      // And per (3.19): dE/dt itself should equal the aero-only power sum.
      expect(Math.abs(dEdt - aeroEnergyPower(forces, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });
});
