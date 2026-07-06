import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobianScratch, finiteDifferenceJacobian } from "./jacobian.js";
import type { Model } from "./model.js";

/** Central finite-difference Jacobian of `model.rhs`, scaled step per component. */
function centralDifferenceJacobian(
  model: Model,
  ctx: EvalContext,
  t: number,
  y0: Float64Array,
): Float64Array {
  const n = model.dim;
  const h = 1e-6;
  const jac = new Float64Array(n * n);
  const yPerturbed = Float64Array.from(y0);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    const step = h * Math.max(1, Math.abs(y0[j]!));
    yPerturbed[j] = y0[j]! + step;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = y0[j]! - step;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = y0[j]!;

    for (let i = 0; i < n; i++) {
      jac[i * n + j] = (fPlus[i]! - fMinus[i]!) / (2 * step);
    }
  }
  return jac;
}

const STATES: readonly [number, number, number, number][] = [
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

describe("gravityQuadraticDragJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;

  function buildModel() {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    return { model, ctx };
  }

  it("is wired as model.jacobian for the exact gravity+quadratic-drag force set", () => {
    const { model } = buildModel();
    expect(model.jacobian).toBeDefined();
  });

  it("matches central finite differences to 1e-7 at 10 random states", () => {
    const { model, ctx } = buildModel();

    for (const state of STATES) {
      const y = Float64Array.from(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = centralDifferenceJacobian(model, ctx, 0, y);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("is left undefined when Magnus (no analytic formula) is in the force set", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();
  });

  it("velocity block is exactly zero at v_rel = 0 (matches the C^1 kink, §3.8)", () => {
    const { model, ctx } = buildModel();
    const out = new Float64Array(16);
    model.jacobian!(0, new Float64Array([0, 0, 0, 0]), out, ctx);
    expect(Array.from(out.subarray(8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("finiteDifferenceJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;

  function buildGravityDragModel() {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    return { model, ctx };
  }

  it("matches the P1.22 analytic Jacobian where available (10 states)", () => {
    const { model, ctx } = buildGravityDragModel();
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(fd[k]! - analytic[k]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("does not mutate the input state", () => {
    const { model, ctx } = buildGravityDragModel();
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);
    const y = Float64Array.from([1, 2, 12.3, 4.1]);
    const yBefore = Float64Array.from(y);
    const out = new Float64Array(16);

    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);

    expect(Array.from(y)).toEqual(Array.from(yBefore));
  });

  it("agrees with an independent central-difference implementation for a model with no analytic jacobian (Magnus present)", () => {
    const cd = new ConstantCd(0.47);
    const cl = new SaturatingLiftCoefficient();
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFiniteDifferenceJacobianScratch(model.dim);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);
      const reference = centralDifferenceJacobian(model, ctx, 0, y);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(fd[k]! - reference[k]!)).toBeLessThan(1e-5);
      }
    }
  });
});
