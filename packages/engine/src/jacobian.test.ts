import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";

const N = 4;
const FD_STEP = 1e-6;

/** Central finite-difference Jacobian of model.rhs at (t, y), column-by-column. */
function centralDifferenceJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: ReturnType<typeof createEvalContext>,
): Float64Array {
  const out = new Float64Array(N * N);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(N);
  const fMinus = new Float64Array(N);

  for (let j = 0; j < N; j++) {
    yPlus.set(y);
    yMinus.set(y);
    yPlus[j] = yPlus[j]! + FD_STEP;
    yMinus[j] = yMinus[j]! - FD_STEP;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let i = 0; i < N; i++) {
      out[i * N + j] = (fPlus[i]! - fMinus[i]!) / (2 * FD_STEP);
    }
  }
  return out;
}

describe("gravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });

  // Same fixture states used for the P1.20 hand-expanded-RHS check.
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
      const analytic = new Float64Array(N * N);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);

      const fdCtx = createEvalContext(env, params);
      const fd = centralDifferenceJacobian(model, 0, y, fdCtx);

      for (let idx = 0; idx < N * N; idx++) {
        expect(Math.abs(analytic[idx]! - fd[idx]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("drag block is symmetric (gradient of a scalar potential)", () => {
    const y = new Float64Array([0, 0, 12.3, -7.8]);
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(N * N);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    expect(out[2 * N + 3]).toBeCloseTo(out[3 * N + 2]!, 15);
  });

  it("is exactly zero at v_rel = 0 (removable singularity guard)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(N * N);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    expect(out[2 * N + 2]).toBe(0);
    expect(out[2 * N + 3]).toBe(0);
    expect(out[3 * N + 2]).toBe(0);
    expect(out[3 * N + 3]).toBe(0);
    // kinematic rows are unaffected by the guard
    expect(out[0 * N + 2]).toBe(1);
    expect(out[1 * N + 3]).toBe(1);
  });
});
