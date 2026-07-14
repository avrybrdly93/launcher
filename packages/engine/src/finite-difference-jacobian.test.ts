import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

const DIM = 4;

// Same deterministic pseudo-random states used in jacobian.test.ts.
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

describe("createFiniteDifferenceJacobian (P1.23)", () => {
  it("matches P1.22's analytic gravity+quadratic-drag jacobian to 1e-5", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const analyticCtx = createEvalContext(env, params);
    const fdCtx = createEvalContext(env, params);

    const forces = [new GravityForce(), new QuadraticDragForce()];
    const analyticModel = createPlanarProjectileModel(forces, analyticCtx);
    const fdModel = createPlanarProjectileModel(forces);
    const fdJacobian = createFiniteDifferenceJacobian(fdModel, fdCtx);

    const t = 1.5;
    const analytic = new Float64Array(DIM * DIM);
    const fd = new Float64Array(DIM * DIM);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);

      analyticModel.jacobian!(t, y, analytic);
      fdJacobian(t, y, fd);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(fd[i]!, `entry ${i} at state (${x},${yPos},${vx},${vy})`).toBeCloseTo(
          analytic[i]!,
          5,
        );
      }
    }
  });

  it("also covers forces P1.22 cannot: gravity+quadratic-drag+Magnus", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);
    const t = 0.3;
    const y = new Float64Array([0, 0, 25, 10]);
    const h = 1e-6;
    const out = new Float64Array(DIM * DIM);
    fdJacobian(t, y, out);

    // Cross-check one entry (d(vx_dot)/d(vy)) against a hand-rolled central
    // difference over the full composed rhs (drag + Magnus together).
    const yPlus = new Float64Array(y);
    const yMinus = new Float64Array(y);
    yPlus[3] = y[3]! + h;
    yMinus[3] = y[3]! - h;
    const fPlus = new Float64Array(DIM);
    const fMinus = new Float64Array(DIM);
    model.rhs(t, yPlus, fPlus, ctx);
    model.rhs(t, yMinus, fMinus, ctx);
    const expected = (fPlus[2]! - fMinus[2]!) / (2 * h);

    expect(out[2 * DIM + 3]).toBeCloseTo(expected, 4);
  });

  it("does not allocate on repeated calls after warmup", () => {
    expect(typeof global.gc).toBe("function");

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model: Model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
    ]);
    const fdJacobian = createFiniteDifferenceJacobian(model, ctx);

    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(DIM * DIM);

    const ITERS = 2e4;
    const WARMUP = 5_000;
    const step = (t: number): void => {
      fdJacobian(t, y, out);
      y[2] = 30 + out[8]! * 1e-9;
      y[3] = 10 + out[12]! * 1e-9;
    };

    let t = 0;
    for (let i = 0; i < WARMUP; i++) step(t++ * 1e-3);

    global.gc!();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERS; i++) step(t++ * 1e-3);
    global.gc!();
    const after = process.memoryUsage().heapUsed;

    expect((after - before) / ITERS).toBeLessThan(5);
  });
});
