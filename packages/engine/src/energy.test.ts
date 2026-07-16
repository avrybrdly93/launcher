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
} from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { energyDerivativeFromPowers, energyDerivativeFromRhs, mechanicalEnergy } from "./energy.js";
import { norm } from "./vec2.js";

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
];

function makeCtx(
  forces: readonly (GravityForce | QuadraticDragForce | MagnusForce | BuoyancyForce)[],
) {
  const mass = 0.145;
  const radius = 0.0366;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: new SaturatingLiftCoefficient(),
    spin: 180,
  });
  const ctx = createEvalContext(env, params);
  const registry = createForceRegistry(forces);
  return { ctx, env, registry, mass };
}

describe("energy invariant (eq. 3.19)", () => {
  it("drag-off: dE/dt from powers is exactly 0 to 1e-13 (gravity alone)", () => {
    const { ctx, env, registry } = makeCtx([new GravityForce()]);
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(energyDerivativeFromPowers(registry, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("Magnus-only: energy is conserved (F_M does no work, still air)", () => {
    const { ctx, env, registry } = makeCtx([new GravityForce(), new MagnusForce()]);
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(energyDerivativeFromPowers(registry, 0, y, ctx))).toBeLessThan(1e-9);
    }
  });

  it("drag-on: dE/dt from powers is monotone non-positive in still air", () => {
    const { ctx, env, registry } = makeCtx([new GravityForce(), new QuadraticDragForce()]);
    for (const state of STATES) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(energyDerivativeFromPowers(registry, 0, y, ctx)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("matches the independently-derived rhs dE/dt for every force combination (wiring check)", () => {
    const combos: (GravityForce | QuadraticDragForce | MagnusForce | BuoyancyForce)[][] = [
      [new GravityForce()],
      [new GravityForce(), new QuadraticDragForce()],
      [new GravityForce(), new MagnusForce()],
      [new GravityForce(), new QuadraticDragForce(), new MagnusForce(), new BuoyancyForce()],
    ];

    for (const forces of combos) {
      const { ctx, env, registry, mass } = makeCtx(forces);
      const model = createPlanarProjectileModel(forces);
      for (const state of STATES) {
        const y = new Float64Array(state);
        refreshDerived(ctx, env, 0, y);
        const fromPowers = energyDerivativeFromPowers(registry, 0, y, ctx);
        const fromRhs = energyDerivativeFromRhs(model, 0, y, ctx, mass, ctx.env.g);
        expect(fromPowers).toBeCloseTo(fromRhs, 10);
      }
    }
  });

  it("createPlanarProjectileModel wires an 'energy' InvariantSpec matching mechanicalEnergy", () => {
    const { ctx, env, mass } = makeCtx([new GravityForce(), new QuadraticDragForce()]);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");

    const y = new Float64Array([0, 10, 20, -5]);
    refreshDerived(ctx, env, 0, y);
    const evaluated = model.invariants?.[0]?.evaluate(0, y, ctx);
    expect(evaluated).toBeCloseTo(mechanicalEnergy(y, mass, ctx.env.g), 12);
  });
});
