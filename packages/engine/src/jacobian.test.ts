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
const VX_ROW_VX = 2 * DIM + 2;

/** Central finite-difference Jacobian, scaled step per component (P1.23-style). */
function finiteDifferenceJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): Float64Array {
  const J = new Float64Array(DIM * DIM);
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPlus.set(y);
    yMinus.set(y);
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;

    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);

    for (let i = 0; i < DIM; i++) {
      J[i * DIM + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }

  return J;
}

describe("gravityQuadraticDragJacobian", () => {
  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(env, params);

    // Deterministic pseudo-random states (avoid a test dependency on a RNG library).
    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 6.001, -4.002],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      const fd = finiteDifferenceJacobian(model, 0, y, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("vanishes smoothly (no NaN) at v_rel = 0", () => {
    const cd = new ConstantCd(0.47);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: cd,
    });
    const ctx = createEvalContext(env, params);

    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(DIM * DIM);
    gravityQuadraticDragJacobian(0, y, out, ctx);

    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(out[VX_ROW_VX]).toBe(0);
  });
});
