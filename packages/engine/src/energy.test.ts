import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce, type ForceModel } from "./forces.js";
import { norm } from "./vec2.js";
import { aeroPower, ENERGY_INVARIANT, mechanicalEnergy } from "./energy.js";

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

/** Fills ctx.env/vRel/speedRel/re/mach the same way planarProjectileModel.rhs would (forces.test.ts pattern). */
function refreshDerived(ctx: EvalContext, env: Environment, t: number, y: Float64Array): void {
  env.sample(t, y[0]!, y[1]!, ctx.env);
  ctx.vRel[0] = y[2]! - ctx.env.wx;
  ctx.vRel[1] = y[3]! - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}

describe("mechanicalEnergy / ENERGY_INVARIANT", () => {
  it("equals (1/2)m|v|^2 + mgy exactly", () => {
    const { ctx } = makeContext();
    const y = new Float64Array([3, 20, 10, -5]);
    const e = mechanicalEnergy(0, y, ctx);
    const expected = 0.5 * ctx.params.mass * (10 * 10 + 5 * 5) + ctx.params.mass * 9.80665 * 20;
    expect(e).toBeCloseTo(expected, 10);
  });

  it("ENERGY_INVARIANT.evaluate is mechanicalEnergy, registrable as a Model invariant", () => {
    const { ctx } = makeContext();
    const y = new Float64Array([0, 5, 4, 3]);
    expect(ENERGY_INVARIANT.name).toBe("energy");
    expect(ENERGY_INVARIANT.evaluate(0, y, ctx)).toBe(mechanicalEnergy(0, y, ctx));
  });
});

describe("aeroPower (eq. 3.19: dE/dt = F_aero . v)", () => {
  const states: Array<[number, number, number, number]> = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [100, 10, -1.5, -1.5],
    [5, 5, 5, 5],
  ];

  it("with all aero forces off, dE/dt from powers is exactly 0 (§3.8 check i)", () => {
    const { ctx, env } = makeContext();
    const noAeroForces: readonly ForceModel[] = [];
    for (const state of states) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(aeroPower(noAeroForces, 0, y, ctx)).toBe(0);
    }
  });

  it("with drag disabled (Cd=0) but wired in, dE/dt from powers is exactly 0", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0),
    });
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    const drag = new QuadraticDragForce();
    for (const state of states) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(aeroPower([drag], 0, y, ctx)).toBe(0);
    }
  });

  it("drag off, Magnus only, still air: dE/dt from powers = 0 to 1e-13 (§3.8 check ii)", () => {
    const { ctx, env } = makeContext({ spin: 180, withLift: true });
    const magnus = new MagnusForce();
    for (const state of states) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(aeroPower([magnus], 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("drag on in still air: dE/dt from powers is <= 0 (strictly dissipative, §3.8 check iii)", () => {
    const { ctx, env } = makeContext();
    const drag = new QuadraticDragForce();
    for (const state of states) {
      const y = new Float64Array(state);
      const [, , vx, vy] = state;
      if (vx === 0 && vy === 0) continue; // dE/dt = 0 trivially at rest
      refreshDerived(ctx, env, 0, y);
      expect(aeroPower([drag], 0, y, ctx)).toBeLessThanOrEqual(0);
    }
  });

  it("excludes gravity from the aero sum: aeroPower([gravity]) is nonzero in general (would double-count E)", () => {
    const { ctx, env } = makeContext();
    const gravity = new GravityForce();
    const y = new Float64Array([0, 0, 0, 10]);
    refreshDerived(ctx, env, 0, y);
    expect(aeroPower([gravity], 0, y, ctx)).not.toBe(0);
  });
});
