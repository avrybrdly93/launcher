import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

const DIM = 4;
const VX = 2;
const VY = 3;

/** Central-difference Jacobian of `model.rhs`, one column (state component) at a time. */
function fdJacobian(
  model: ReturnType<typeof createPlanarProjectileModel>,
  ctx: ReturnType<typeof createEvalContext>,
  t: number,
  y: Float64Array,
  out: Float64Array,
): void {
  const yPlus = new Float64Array(y);
  const yMinus = new Float64Array(y);
  const fPlus = new Float64Array(DIM);
  const fMinus = new Float64Array(DIM);

  for (let j = 0; j < DIM; j++) {
    const h = Math.max(1e-6, Math.abs(y[j]!) * 1e-6);
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;

    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);

    for (let i = 0; i < DIM; i++) {
      out[DIM * i + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }

    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
  }
}

describe("createGravityQuadraticDragJacobian", () => {
  it("matches central finite differences to 1e-7 at 10 states (P1.22 validation)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(env, params);
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);

    const states: Float64Array[] = [
      new Float64Array([0, 0, 30, 20]),
      new Float64Array([10, 5, -15, 8]),
      new Float64Array([0, 100, 0, -40]),
      new Float64Array([5, 2, 25, -25]),
      new Float64Array([0, 0, 1, 0.5]),
      new Float64Array([2, 3, -5, -5]),
      new Float64Array([0, 50, 40, 0]),
      new Float64Array([-3, 7, 12, 33]),
      new Float64Array([0, 0, -0.2, 0.1]),
      new Float64Array([1, 1, 50, -10]),
    ];

    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const y of states) {
      analyticJacobian(0, y, analytic);
      fdJacobian(model, ctx, 0, y, fd);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("is zero in the drag block at v_rel = 0 (removable singularity, §3.8)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);
    const out = new Float64Array(DIM * DIM);
    analyticJacobian(0, new Float64Array([0, 0, 0, 0]), out);

    expect(out[DIM * VX + VX]).toBe(0);
    expect(out[DIM * VX + VY]).toBe(0);
    expect(out[DIM * VY + VX]).toBe(0);
    expect(out[DIM * VY + VY]).toBe(0);
    expect(Number.isFinite(out[DIM * VX + VX]!)).toBe(true);
  });
});
