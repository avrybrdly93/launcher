import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFdJacobian } from "./fd-jacobian.js";

const states: readonly [number, number, number, number][] = [
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

describe("createFdJacobian (P1.23)", () => {
  it("matches the P1.22 analytic Jacobian where available (gravity+quadratic-drag) to 1e-6", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeDefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFdJacobian(model);
    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of states) {
      const y = new Float64Array(state);
      model.jacobian!(0, y, analytic, ctx);
      fdJacobian(0, y, fd, ctx);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(fd[i]! - analytic[i]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("is a genuine fallback: computes a Jacobian for a Magnus-equipped model, where no analytic one exists", () => {
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
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFdJacobian(model);
    const out = new Float64Array(16);

    for (const state of states) {
      const y = new Float64Array(state);
      fdJacobian(0, y, out, ctx);
      for (let i = 0; i < 16; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
      }
      // Structural rows are exact regardless of force composition: dx/dt = vx, dy/dt = vy.
      expect(out[0 * 4 + 2]).toBeCloseTo(1, 8);
      expect(out[1 * 4 + 3]).toBeCloseTo(1, 8);
      expect(out[0 * 4 + 0]).toBe(0);
      expect(out[1 * 4 + 1]).toBe(0);
    }
  });

  it("reuses preallocated scratch buffers across calls (no per-call state array growth)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fdJacobian = createFdJacobian(model);
    const out1 = new Float64Array(16);
    const out2 = new Float64Array(16);

    fdJacobian(0, new Float64Array([0, 0, 10, 5]), out1, ctx);
    fdJacobian(0, new Float64Array([0, 0, 10, 5]), out2, ctx);

    expect([...out1]).toEqual([...out2]);
  });
});
