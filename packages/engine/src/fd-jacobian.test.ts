import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFdJacobianScratch, finiteDifferenceJacobian } from "./fd-jacobian.js";

const DIM = 4;

describe("finiteDifferenceJacobian", () => {
  const cd = new ConstantCd(0.47);
  const mass = 0.145;
  const radius = 0.0366;
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);

  const states: Array<[number, number, number, number]> = [
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

  it("matches P1.22's analytic gravity+quadratic-drag Jacobian where available", () => {
    const scratch = createFdJacobianScratch(DIM);
    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      const fd = new Float64Array(DIM * DIM);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(fd[k]!).toBeCloseTo(analytic[k]!, 6);
      }
    }
  });

  it("does not mutate the input state", () => {
    const scratch = createFdJacobianScratch(DIM);
    const y = new Float64Array([3, 7, -5, 12]);
    const snapshot = Float64Array.from(y);
    const out = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);
    expect(y).toEqual(snapshot);
  });

  it("is exact on the purely kinematic rows: dx'/dvx ~= 1, dy'/dvy ~= 1", () => {
    const scratch = createFdJacobianScratch(DIM);
    const y = new Float64Array([1, 2, 30, -15]);
    const out = new Float64Array(DIM * DIM);
    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 9);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 9);
  });

  it("allocates ~0 bytes per call across 1e5 evaluations after warmup", () => {
    expect(typeof global.gc).toBe("function");

    const scratch = createFdJacobianScratch(DIM);
    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(DIM * DIM);

    const ITERS = 1e5;
    const WARMUP = 20_000;

    const step = (t: number): void => {
      finiteDifferenceJacobian(model, t, y, ctx, out, scratch);
      y[0] = out[8]! * 1e-6;
      y[1] = 10 + out[9]! * 1e-6;
      y[2] = 30 + out[10]! * 1e-6;
      y[3] = 10 + out[11]! * 1e-6;
    };

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
