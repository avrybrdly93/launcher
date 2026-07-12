import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

const DIM = 4;

/** Central-difference df/dy at (t, y), scaled per-component step (standard practice, P1.23 territory). */
function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): Float64Array {
  const jac = new Float64Array(DIM * DIM);
  const yPerturbed = Float64Array.from(y);
  const outPlus = new Float64Array(DIM);
  const outMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const original = y[j]!;
    const h = 1e-6 * Math.max(1, Math.abs(original));

    yPerturbed[j] = original + h;
    model.rhs(t, yPerturbed, outPlus, ctx);
    yPerturbed[j] = original - h;
    model.rhs(t, yPerturbed, outMinus, ctx);
    yPerturbed[j] = original;

    for (let i = 0; i < DIM; i++) {
      jac[i * DIM + j] = (outPlus[i]! - outMinus[i]!) / (2 * h);
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

  it("matches central finite differences to 1e-7 at 10 states", () => {
    const ctx = createEvalContext(env, params);

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);

      const fd = finiteDifferenceJacobian(model, 0, y, ctx);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("is exactly zero in the drag block (and identity in the kinematic block) at rest", () => {
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, out, ctx);

    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
