import { describe, expect, it } from "vitest";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { aeroPower, createEnergyInvariant, mechanicalEnergy } from "./energy.js";
import { createForceRegistry, GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { G_STD } from "./units.js";
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

describe("mechanicalEnergy", () => {
  it("computes E = (1/2)*m*|v|^2 + m*g*y", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 2,
      radius: 0.1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([0, 5, 3, 4]);
    const expected = 0.5 * 2 * (3 * 3 + 4 * 4) + 2 * G_STD * 5;
    expect(mechanicalEnergy(0, y, ctx)).toBeCloseTo(expected, 12);
  });
});

describe("aeroPower", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());

  it("excludes gravity: drag-off (gravity-only registry) => aeroPower ≡ 0 to 1e-13", () => {
    const registry = createForceRegistry([new GravityForce()]);
    const ctx = createEvalContext(env, params);

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

    for (const state of states) {
      const y = new Float64Array(state);
      refreshDerived(ctx, env, 0, y);
      expect(Math.abs(aeroPower(registry, 0, y, ctx))).toBeLessThan(1e-13);
    }
  });

  it("includes drag: with quadratic drag registered, aeroPower equals the drag force's own power", () => {
    const registry = createForceRegistry([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 20, -5]);
    refreshDerived(ctx, env, 0, y);

    const drag = new QuadraticDragForce();
    const expectedDragPower = drag.energyPower!(0, y, ctx);

    expect(expectedDragPower).not.toBe(0);
    expect(aeroPower(registry, 0, y, ctx)).toBeCloseTo(expectedDragPower, 12);
  });
});

describe("createEnergyInvariant / createPlanarProjectileModel wiring", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());

  it("planarProjectileModel exposes the energy invariant", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.invariants?.[0]?.name).toBe("energy");
  });

  it("drag-off: dE/dt from powers ≡ 0 to 1e-13, and E is conserved along an actual RK4 trajectory", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const registry = createForceRegistry([new GravityForce()]);
    const invariant = createEnergyInvariant();
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([0, 100, 20, 15]);
    const E0 = invariant.evaluate(0, y, ctx);

    // Classical RK4, dt small enough that the O(h^4) truncation error is far
    // below the 1e-13 energy tolerance we're asserting on.
    const dt = 1e-3;
    const k1 = new Float64Array(4);
    const k2 = new Float64Array(4);
    const k3 = new Float64Array(4);
    const k4 = new Float64Array(4);
    const yTmp = new Float64Array(4);

    for (let step = 0; step < 500; step++) {
      const t = step * dt;
      model.rhs(t, y, k1, ctx);
      for (let i = 0; i < 4; i++) yTmp[i] = y[i]! + (dt / 2) * k1[i]!;
      model.rhs(t + dt / 2, yTmp, k2, ctx);
      for (let i = 0; i < 4; i++) yTmp[i] = y[i]! + (dt / 2) * k2[i]!;
      model.rhs(t + dt / 2, yTmp, k3, ctx);
      for (let i = 0; i < 4; i++) yTmp[i] = y[i]! + dt * k3[i]!;
      model.rhs(t + dt, yTmp, k4, ctx);
      for (let i = 0; i < 4; i++) {
        y[i] = y[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
      }

      // Instantaneous check at every step: no aero forces registered, so the
      // eq. (3.19) power sum is identically zero (P1.24's validation criterion).
      expect(Math.abs(aeroPower(registry, t, y, ctx))).toBeLessThan(1e-13);
    }

    const Ef = invariant.evaluate(500 * dt, y, ctx);
    expect(Math.abs(Ef - E0) / E0).toBeLessThan(1e-9);
  });
});
