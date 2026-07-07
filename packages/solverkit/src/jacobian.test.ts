import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  Environment,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  SaturatingLiftCoefficient,
  UniformGravity,
  ZeroWind,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { createFdJacobianScratch, fdJacobian, fdJacobianAlloc, jacobianOf } from "./jacobian.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.01, -0.02],
  [100, 10, -80, -60],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 150, 150],
  [-10, -10, -200, 20],
  [1, 1, 33.3, -12.7],
];

describe("fdJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available (gravity + quadratic drag)", () => {
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
    const scratch = createFdJacobianScratch(model.dim);

    expect(model.jacobian).toBeDefined();

    for (const state of STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = new Float64Array(16);
      fdJacobian(model, 0, y, fd, ctx, scratch);
      for (let k = 0; k < 16; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 5); // |fd - analytic| < 1.5e-5
      }
    }
  });

  it("works generically on a model with no analytic jacobian (Magnus included)", () => {
    const mass = 0.0459;
    const radius = 0.02135;
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
      dragCoefficient: new ConstantCd(0.3),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 200,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(model.dim);
    const y = new Float64Array([0, 1, 40, 5]);
    const fd = new Float64Array(16);
    fdJacobian(model, 0, y, fd, ctx, scratch);

    // Top-left partitions block: dx/dt = vx and dy/dt = vy exactly, regardless of forces.
    expect(fd[2]).toBeCloseTo(1, 6);
    expect(fd[7]).toBeCloseTo(1, 6);
    for (const v of fd) expect(Number.isFinite(v)).toBe(true);
  });

  it("jacobianOf dispatches to the analytic path when present and FD otherwise", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(4);
    const y = new Float64Array([0, 0, 20, -10]);

    const analyticModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
    ]);
    const viaDispatch = new Float64Array(16);
    jacobianOf(analyticModel, 0, y, viaDispatch, ctx, scratch);
    const viaAnalytic = new Float64Array(16);
    analyticModel.jacobian!(0, y, viaAnalytic, ctx);
    expect(viaDispatch).toEqual(viaAnalytic);

    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const viaDispatchFd = new Float64Array(16);
    jacobianOf(magnusModel, 0, y, viaDispatchFd, ctx, scratch);
    const viaFd = new Float64Array(16);
    fdJacobian(magnusModel, 0, y, viaFd, ctx, scratch);
    expect(viaDispatchFd).toEqual(viaFd);
  });

  it("allocates ~0 bytes/iter given caller-supplied scratch and out buffers, after warmup", () => {
    expect(typeof global.gc).toBe("function");

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const scratch = createFdJacobianScratch(model.dim);
    const out = new Float64Array(16);
    const y = new Float64Array([0, 0, 20, -10]);

    const step = (t: number): void => {
      fdJacobian(model, t, y, out, ctx, scratch);
      // Vary the state from the output so the JIT can't constant-fold the loop away.
      y[0] = out[8]! * 1e-6;
      y[1] = 10 + out[9]! * 1e-6;
      y[2] = 20 + out[10]! * 1e-6;
      y[3] = -10 + out[11]! * 1e-6;
    };

    const ITERS = 1e4;
    const WARMUP = 5_000;
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

  it("fdJacobianAlloc matches the scratch-based path", () => {
    const model: Model = {
      dim: 1,
      channels: [{ name: "y", unit: "1" }],
      rhs(_t, y, out, _ctx: EvalContext) {
        out[0] = -y[0]!;
      },
    };
    const ctx = {} as EvalContext;
    const out = fdJacobianAlloc(model, 0, new Float64Array([2]), ctx);
    expect(out[0]).toBeCloseTo(-1, 6);
  });
});
