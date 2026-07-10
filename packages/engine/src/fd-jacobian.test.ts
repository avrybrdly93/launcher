import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createFiniteDifferenceJacobian } from "./fd-jacobian.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";

const DIM = 4;

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic gravity+quadratic-drag Jacobian where available", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);

    const states: Float64Array[] = [
      new Float64Array([0, 0, 30, 20]),
      new Float64Array([10, 5, -15, 8]),
      new Float64Array([0, 100, 0, -40]),
      new Float64Array([5, 2, 25, -25]),
      new Float64Array([2, 3, -5, -5]),
      new Float64Array([0, 50, 40, 0]),
      new Float64Array([-3, 7, 12, 33]),
      new Float64Array([1, 1, 50, -10]),
    ];

    const fd = new Float64Array(DIM * DIM);
    const analytic = new Float64Array(DIM * DIM);

    for (const y of states) {
      fdJacobian(0, y, fd);
      analyticJacobian(0, y, analytic);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(Math.abs(fd[k]! - analytic[k]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("scales the step with |y_j|: a component near zero doesn't get an oversized step", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);
    const analyticJacobian = createGravityQuadraticDragJacobian(env, params);

    // vx = 0 exactly: the drag block derivative there is a removable
    // singularity resolved to zero (P1.22); FD must land close to that.
    const y = new Float64Array([0, 0, 0, 25]);
    const fd = new Float64Array(DIM * DIM);
    const analytic = new Float64Array(DIM * DIM);
    fdJacobian(0, y, fd);
    analyticJacobian(0, y, analytic);

    for (let k = 0; k < DIM * DIM; k++) {
      expect(Math.abs(fd[k]! - analytic[k]!)).toBeLessThan(1e-6);
    }
  });

  it("does not allocate inside the returned closure after construction", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);
    const y = new Float64Array([0, 0, 30, 20]);
    const out = new Float64Array(DIM * DIM);

    expect(typeof global.gc).toBe("function");
    const WARMUP = 5_000;
    const ITERS = 1e5;
    for (let i = 0; i < WARMUP; i++) fdJacobian(0, y, out);

    global.gc!();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERS; i++) fdJacobian(0, y, out);
    global.gc!();
    const after = process.memoryUsage().heapUsed;

    expect((after - before) / ITERS).toBeLessThan(5);
  });
});
