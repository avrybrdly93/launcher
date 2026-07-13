import { describe, expect, it } from "vitest";
import type { EvalContext } from "./eval-context.js";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";

/** Central-difference df_i/dy_j via two rhs evaluations per column (dim^2 total). */
function centralDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h = 1e-6,
): Float64Array {
  const dim = y.length;
  const J = new Float64Array(dim * dim);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const yPlus = Float64Array.from(y);
    const yMinus = Float64Array.from(y);
    yPlus[j] = yPlus[j]! + h;
    yMinus[j] = yMinus[j]! - h;
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    for (let i = 0; i < dim; i++) {
      J[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return J;
}

describe("createGravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;

  function buildContext(): { model: Model; ctx: EvalContext } {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    return { model, ctx: createEvalContext(env, params) };
  }

  it("matches central finite differences to 1e-7 at 10 states", () => {
    const { model, ctx } = buildContext();
    expect(model.jacobian).toBeDefined();

    // Deterministic pseudo-random states (mirrors the rhs cross-check fixture).
    const states: readonly [number, number, number, number][] = [
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
      const y = Float64Array.from(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, 0, y, ctx);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("is undefined when Magnus is present (not differentiated by this formula)", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });

  it("is undefined for gravity alone (drag term absent, not this force pair)", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    expect(model.jacobian).toBeUndefined();
  });

  it("stays finite at v_rel = 0, the removable singularity at the drag kink (§3.8)", () => {
    const { model, ctx } = buildContext();
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    // The v_x'/v_y' block vanishes in the limit, matching the FD trend as h -> 0.
    expect(out[2 * 4 + 2]).toBe(0);
    expect(out[2 * 4 + 3]).toBe(0);
    expect(out[3 * 4 + 2]).toBe(0);
    expect(out[3 * 4 + 3]).toBe(0);
  });

  it("the x/y rows are exactly the identity shift (dx/dt=vx, dy/dt=vy)", () => {
    const { model, ctx } = buildContext();
    const y = new Float64Array([3, -7, 12, 5]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);
    expect(out.subarray(0, 4)).toEqual(new Float64Array([0, 0, 1, 0]));
    expect(out.subarray(4, 8)).toEqual(new Float64Array([0, 0, 0, 1]));
  });
});
