import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian, PLANAR_JACOBIAN_DIM } from "./jacobian.js";

function makeContext(): { ctx: EvalContext; env: Environment } {
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  return { ctx: createEvalContext(env, params), env };
}

/** Central finite-difference Jacobian of `model.rhs` at (t, y), row-major like the analytic one. */
function fdJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h: number,
): Float64Array {
  const dim = model.dim;
  const out = new Float64Array(dim * dim);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);
  for (let j = 0; j < dim; j++) {
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
  }
  return out;
}

const RANDOM_STATES: readonly [number, number, number, number][] = [
  [0, 0, 10, 5],
  [3, -2, 25, -8],
  [-10, 5, -15, 20],
  [0, 100, 0.5, -0.3],
  [50, -50, 40, 40],
  [1, 1, -30, 12],
  [-5, 20, 18, -18],
  [0, 0, 1e-3, -1e-3],
  [7, -3, 5, 0],
  [-2, 8, 0, -22],
];

describe("gravityQuadraticDragJacobian", () => {
  const { ctx } = makeContext();
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

  it("matches central finite differences of the rhs to 1e-7 at 10 random states", () => {
    const analytic = new Float64Array(PLANAR_JACOBIAN_DIM * PLANAR_JACOBIAN_DIM);
    for (const state of RANDOM_STATES) {
      const y = new Float64Array(state);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      const fd = fdJacobian(model, 0, y, ctx, 1e-5);
      for (let k = 0; k < analytic.length; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("returns finite zeros in the drag block at v_rel = 0 (no NaN)", () => {
    const out = new Float64Array(PLANAR_JACOBIAN_DIM * PLANAR_JACOBIAN_DIM);
    const y = new Float64Array([0, 0, 0, 0]);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    // kinematic block (dx/dvx, dy/dvy) is unaffected by the v_rel=0 guard.
    expect(out[0 * PLANAR_JACOBIAN_DIM + 2]).toBe(1);
    expect(out[1 * PLANAR_JACOBIAN_DIM + 3]).toBe(1);
    // drag block vanishes in the limit.
    expect(out[2 * PLANAR_JACOBIAN_DIM + 2]).toBe(0);
    expect(out[3 * PLANAR_JACOBIAN_DIM + 3]).toBe(0);
  });
});
