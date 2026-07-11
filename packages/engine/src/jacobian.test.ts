import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

/** Central finite-difference Jacobian, relative step scaled per component (§4.1 LTE discussion applies analogously here). */
function centralFdJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  h: number,
): Float64Array {
  const dim = model.dim;
  const out = new Float64Array(dim * dim);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const step = h * Math.max(1, Math.abs(y[j]!));
    yPlus.set(y);
    yMinus.set(y);
    yPlus[j] = y[j]! + step;
    yMinus[j] = y[j]! - step;

    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);

    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * step);
    }
  }

  return out;
}

describe("gravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);

  it("is wired onto the model for gravity + quadratic drag", () => {
    expect(model.jacobian).toBeDefined();
  });

  it("matches central finite differences to 1e-7 at 10 states", () => {
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

    const h = 1e-5;

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);

      const fd = centralFdJacobian(model, 0, y, ctx, h);

      for (let i = 0; i < 16; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("returns the exact zero drag-Jacobian block at v_rel = 0 (the C1-not-C2 kink, §3.8)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);

    expect(out).toEqual(new Float64Array([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]));
  });

  it("is left unset when Magnus is present (no closed form yet, P1.23 covers the fallback)", () => {
    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(magnusModel.jacobian).toBeUndefined();
  });
});
