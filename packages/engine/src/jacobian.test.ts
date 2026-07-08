import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

/** Central-difference Jacobian of model.rhs, scaled step per component. */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h = 1e-6,
): Float64Array {
  const n = model.dim;
  const J = new Float64Array(n * n);
  const yPerturbed = Float64Array.from(y);
  const outPlus = new Float64Array(n);
  const outMinus = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    const hj = h * Math.max(1, Math.abs(y[j]!));
    yPerturbed[j] = y[j]! + hj;
    model.rhs(t, yPerturbed, outPlus, ctx);
    yPerturbed[j] = y[j]! - hj;
    model.rhs(t, yPerturbed, outMinus, ctx);
    yPerturbed[j] = y[j]!;

    for (let i = 0; i < n; i++) {
      J[n * i + j] = (outPlus[i]! - outMinus[i]!) / (2 * hj);
    }
  }
  return J;
}

describe("gravityQuadraticDragJacobian", () => {
  it("matches the central finite-difference Jacobian of the full rhs to 1e-7 at 10 random states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    // Deterministic pseudo-random states (avoid a test dependency on a RNG library);
    // all away from the u=0 kink where the drag Jacobian is genuinely discontinuous.
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 3.2, -4.4],
      [100, 10, -1.5, -6.5],
      [0, 0, 40, 0.1],
      [0, 0, 0.1, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("kinematic block is exact: dx/dvx = dy/dvy = 1, no position dependence", () => {
    const cd = new ConstantCd(0.47);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass: 1, radius: 0.05, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([3, -7, 10, -10]), ctx, out);

    expect(out[4 * 0 + 2]).toBe(1);
    expect(out[4 * 1 + 3]).toBe(1);
    expect(out[4 * 0 + 0]).toBe(0);
    expect(out[4 * 0 + 1]).toBe(0);
    expect(out[4 * 1 + 0]).toBe(0);
    expect(out[4 * 1 + 1]).toBe(0);
    expect(out[4 * 2 + 0]).toBe(0);
    expect(out[4 * 2 + 1]).toBe(0);
    expect(out[4 * 3 + 0]).toBe(0);
    expect(out[4 * 3 + 1]).toBe(0);
  });

  it("returns the zero matrix at the u=0 kink (no NaN)", () => {
    const cd = new ConstantCd(0.47);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass: 1, radius: 0.05, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([0, 0, 0, 0]), ctx, out);

    expect(out[4 * 2 + 2]).toBe(0);
    expect(out[4 * 2 + 3]).toBe(0);
    expect(out[4 * 3 + 2]).toBe(0);
    expect(out[4 * 3 + 3]).toBe(0);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});
