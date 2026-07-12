import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobian, gravityQuadraticDragJacobian } from "./jacobian.js";

/** Central-difference Jacobian of `model.rhs`, row-major dim*dim, for comparison. */
function finiteDifferenceJacobian(
  rhs: (t: number, y: Float64Array, out: Float64Array) => void,
  t: number,
  y: Float64Array,
): Float64Array {
  const dim = y.length;
  const jac = new Float64Array(dim * dim);
  const yPlus = Float64Array.from(y);
  const yMinus = Float64Array.from(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(y[j]!));
    yPlus[j] = y[j]! + h;
    yMinus[j] = y[j]! - h;
    rhs(t, yPlus, fPlus);
    rhs(t, yMinus, fMinus);
    yPlus[j] = y[j]!;
    yMinus[j] = y[j]!;
    for (let i = 0; i < dim; i++) {
      jac[i * dim + j] = (fPlus[i]! - fMinus[i]!) / (2 * h);
    }
  }
  return jac;
}

describe("gravityQuadraticDragJacobian", () => {
  it("matches central finite differences of the rhs to 1e-7 at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
      [0, 50, -40, -25],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);

      const fd = finiteDifferenceJacobian((t, yy, out) => model.rhs(t, yy, out, ctx), 0, y);

      for (let k = 0; k < 16; k++) {
        expect(analytic[k]).toBeCloseTo(fd[k]!, 7);
      }
    }
  });

  it("is finite (zero drag contribution) at v_rel = 0", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    gravityQuadraticDragJacobian(0, y, ctx, out);
    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian((t, y, out, c) => model.rhs(t, y, out, c), 4);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
      [0, 50, -40, -25],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      const fd = new Float64Array(16);
      fdJacobian(0, y, ctx, fd);

      for (let k = 0; k < 16; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 6);
      }
    }
  });

  it("reuses its scratch buffers across calls (no growth in output correctness)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian((t, y, out, c) => model.rhs(t, y, out, c), 4);

    const first = new Float64Array(16);
    fdJacobian(0, new Float64Array([0, 0, 12.3, 4.1]), ctx, first);
    const second = new Float64Array(16);
    fdJacobian(0, new Float64Array([10, 5, -8.2, 15.6]), ctx, second);
    // A stale scratch buffer from the first call would leak into the second.
    const analyticSecond = new Float64Array(16);
    gravityQuadraticDragJacobian(0, new Float64Array([10, 5, -8.2, 15.6]), ctx, analyticSecond);
    for (let k = 0; k < 16; k++) {
      expect(second[k]).toBeCloseTo(analyticSecond[k]!, 6);
    }
  });
});
