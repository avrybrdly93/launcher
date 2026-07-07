import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce, type ForceModel } from "./forces.js";
import { energyInvariant, energyRateFromPowers } from "./energy.js";
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

const STATES: [number, number, number, number][] = [
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

describe("energyInvariant", () => {
  it("evaluates E = (1/2)m|v|^2 + mgy", () => {
    const { ctx, env } = makeContext();
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      const [, yPos, vx, vy] = state;
      const expected =
        0.5 * ctx.params.mass * (vx! * vx! + vy! * vy!) + ctx.params.mass * ctx.env.g * yPos!;
      expect(energyInvariant.evaluate(0, y, ctx)).toBeCloseTo(expected, 12);
    }
  });
});

describe("energyRateFromPowers", () => {
  it("drag-off: dE/dt from powers is exactly 0 to 1e-13 (gravity is conservative)", () => {
    const { ctx, env } = makeContext();
    const forces: ForceModel[] = [new GravityForce()];
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(energyRateFromPowers(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });

  it("drag-on in still air: dE/dt matches the closed form -0.5*rho*Cd*A*|v|^3 and is <= 0", () => {
    const { ctx, env } = makeContext();
    const forces: ForceModel[] = [new GravityForce(), new QuadraticDragForce()];
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      const rate = energyRateFromPowers(forces, 0, y, ctx);
      const speed = norm([y[2]!, y[3]!]);
      const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
      const expected = -0.5 * ctx.env.rho * cd * ctx.params.area * speed * speed * speed;
      expect(rate).toBeCloseTo(expected, 10);
      expect(rate).toBeLessThanOrEqual(1e-13);
    }
  });

  it("Magnus-only in still air: dE/dt is 0 to 1e-13 (ideal Magnus force does no work)", () => {
    const { ctx, env } = makeContext({ spin: 180, withLift: true });
    const forces: ForceModel[] = [new GravityForce(), new MagnusForce()];
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(energyRateFromPowers(forces, 0, y, ctx)).toBeCloseTo(0, 13);
    }
  });
});
