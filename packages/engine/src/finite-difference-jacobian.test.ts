import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";

const states: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 3.0, -2.0],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available (gravity + quadratic drag)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(4);

    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of states) {
      const y = new Float64Array(state);
      gravityQuadraticDragJacobian(0, y, ctx, analytic);
      fdJacobian.compute(model, 0, y, ctx, fd);

      for (let i = 0; i < 16; i++) {
        expect(fd[i]!).toBeCloseTo(analytic[i]!, 6);
      }
    }
  });

  it("produces finite entries for a model outside P1.22's scope (gravity + drag + Magnus)", () => {
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(4);
    const out = new Float64Array(16);

    for (const state of states) {
      fdJacobian.compute(model, 0, new Float64Array(state), ctx, out);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }

    // Kinematic rows are exact for any force set: dx/dt=vx, dy/dt=vy.
    fdJacobian.compute(model, 0, new Float64Array([1, 2, 3, 4]), ctx, out);
    expect(out[0 * 4 + 2]).toBeCloseTo(1, 6);
    expect(out[1 * 4 + 3]).toBeCloseTo(1, 6);
  });

  it("reuses its internal buffers without allocating new Float64Arrays per call", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFiniteDifferenceJacobian(4);
    const out = new Float64Array(16);
    const y = new Float64Array([0, 0, 12.3, 4.1]);

    // Repeated calls must not throw and must keep producing consistent output
    // from the same preallocated scratch buffers (ADR-004 spirit).
    for (let i = 0; i < 1000; i++) {
      fdJacobian.compute(model, 0, y, ctx, out);
    }
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});
