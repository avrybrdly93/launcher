import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import {
  createFiniteDifferenceJacobian,
  withFiniteDifferenceJacobianFallback,
} from "./finite-difference-jacobian.js";

const DIM = 4;

function makeEnvAndParams() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  return { env, params };
}

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available (gravity+quadratic-drag)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeDefined(); // analytic (P1.22) is wired for this force set

    const { env, params } = makeEnvAndParams();
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -1.5],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    const analyticJ = new Float64Array(DIM * DIM);
    const fdJ = new Float64Array(DIM * DIM);

    for (const state of states) {
      const y = Float64Array.from(state);
      model.jacobian!(0, y, analyticJ, ctx);
      fdJacobian(0, y, fdJ, ctx);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(Math.abs(analyticJ[i]! - fdJ[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("produces a finite, sensible Jacobian for a model with no analytic formula (Magnus present)", () => {
    const cl = new SaturatingLiftCoefficient();
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined(); // no analytic formula covers Magnus (P1.22 scope)

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model);

    const y = Float64Array.from([0, 0, 20, 10]);
    const out = new Float64Array(DIM * DIM);
    fdJacobian(0, y, out, ctx);

    for (const value of out) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // d(dx/dt)/dvx = 1, d(dy/dt)/dvy = 1 exactly, regardless of force set.
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 6);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 6);
  });

  it("is symmetric under repeated calls (scratch buffers don't leak state across evaluations)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const { env, params } = makeEnvAndParams();
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model);

    const y = Float64Array.from([0, 0, 12.3, 4.1]);
    const first = new Float64Array(DIM * DIM);
    const second = new Float64Array(DIM * DIM);
    fdJacobian(0, y, first, ctx);
    fdJacobian(0, Float64Array.from([10, 5, -8.2, 15.6]), new Float64Array(DIM * DIM), ctx);
    fdJacobian(0, y, second, ctx);

    expect(second).toEqual(first);
  });
});

describe("withFiniteDifferenceJacobianFallback", () => {
  it("leaves a model with an existing analytic jacobian untouched", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const wrapped = withFiniteDifferenceJacobianFallback(model);
    expect(wrapped.jacobian).toBe(model.jacobian);
  });

  it("attaches a finite-difference jacobian when the model has none", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const wrapped = withFiniteDifferenceJacobianFallback(model);
    expect(wrapped.jacobian).toBeDefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const y = Float64Array.from([0, 0, 20, 10]);
    const out = new Float64Array(DIM * DIM);
    wrapped.jacobian!(0, y, out, ctx);

    expect(out[0 * DIM + 2]).toBeCloseTo(1, 6);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 6);
  });
});
