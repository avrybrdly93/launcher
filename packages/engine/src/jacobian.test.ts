import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import type { Model } from "./model.js";

/** Central finite-difference df_i/dy_j, scaled steps, for comparison against the analytic Jacobian. */
function fdJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h = 1e-6,
): Float64Array {
  const n = model.dim;
  const jac = new Float64Array(n * n);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    yPlus.set(y);
    yMinus.set(y);
    const step = h * Math.max(1, Math.abs(y[j]!));
    yPlus[j]! += step;
    yMinus[j]! -= step;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let i = 0; i < n; i++) {
      jac[i * n + j] = (fPlus[i]! - fMinus[i]!) / (2 * step);
    }
  }
  return jac;
}

describe("gravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });

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

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const ctx = createEvalContext(env, params);
      const analytic = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);

      const fdCtx = createEvalContext(env, params);
      const fd = fdJacobian(model, 0, y, fdCtx);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("top-left position rows and position columns are exactly zero", () => {
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([1, 2, 15, -8]), out, ctx);

    // d(x-dot)/dy = [0,0,1,0], d(y-dot)/dy = [0,0,0,1]
    expect([...out.slice(0, 4)]).toEqual([0, 0, 1, 0]);
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 1]);
    // d(*)/dx and d(*)/dy (position columns of accel rows) are zero
    expect(out[8]).toBe(0);
    expect(out[9]).toBe(0);
    expect(out[12]).toBe(0);
    expect(out[13]).toBe(0);
  });

  it("returns zero acceleration-block derivatives at v_rel = 0 (no NaN)", () => {
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 0, 0]), out, ctx);
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[10]).toBe(0);
    expect(out[11]).toBe(0);
    expect(out[14]).toBe(0);
    expect(out[15]).toBe(0);
  });
});
