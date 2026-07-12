import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFdJacobianScratch, finiteDifferenceJacobian } from "./finite-difference-jacobian.js";

const DIM = 4;

describe("finiteDifferenceJacobian", () => {
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

  it("matches the P1.22 analytic Jacobian where available", () => {
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(DIM);

    for (const state of states) {
      const y = new Float64Array(state);

      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, analytic, ctx);

      const fd = new Float64Array(DIM * DIM);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(Math.abs(analytic[k]! - fd[k]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("leaves y unperturbed after returning", () => {
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(DIM);
    const y = new Float64Array([10, 5, -8.2, 15.6]);
    const yBefore = Float64Array.from(y);
    const out = new Float64Array(DIM * DIM);

    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);

    expect(Array.from(y)).toEqual(Array.from(yBefore));
  });

  it("allocates ~0 bytes across 1e4 evaluations after warmup, given pre-created scratch", () => {
    expect(typeof global.gc).toBe("function");

    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(DIM);
    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(DIM * DIM);

    const step = (t: number): void => {
      finiteDifferenceJacobian(model, t, y, ctx, out, scratch);
      y[0] = out[0]! * 1e-9;
      y[1] = 10 + out[1]! * 1e-9;
      y[2] = 30 + out[2]! * 1e-9;
      y[3] = 10 + out[3]! * 1e-9;
    };

    const ITERS = 1e4;
    const WARMUP = 2_000;

    let t = 0;
    for (let i = 0; i < WARMUP; i++) step(t++ * 1e-3);

    global.gc!();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERS; i++) step(t++ * 1e-3);
    global.gc!();
    const after = process.memoryUsage().heapUsed;

    const bytesPerIter = (after - before) / ITERS;
    expect(bytesPerIter).toBeLessThan(5);
  });
});
