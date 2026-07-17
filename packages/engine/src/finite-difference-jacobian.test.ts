import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { finiteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [0, 0.5, 0.001, -0.002],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0.001, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
];

describe("finiteDifferenceJacobian", () => {
  it("matches the P1.22 analytic jacobian (gravity+quadratic-drag) to 1e-6 at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeDefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const analytic = new Float64Array(16);
    const fd = new Float64Array(16);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      model.jacobian!(0, y, ctx, analytic);
      finiteDifferenceJacobian(model, 0, y, ctx, fd);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(fd[i]! - analytic[i]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("falls back correctly where no analytic jacobian exists (gravity+drag+Magnus)", () => {
    const model: Model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);

    const fd = new Float64Array(16);
    finiteDifferenceJacobian(model, 0, Float64Array.from([0, 0, 30, 10]), ctx, fd);

    // Kinematic identity block is exact regardless of force composition.
    expect(fd[0 * 4 + 2]).toBeCloseTo(1, 6);
    expect(fd[1 * 4 + 3]).toBeCloseTo(1, 6);
    expect(fd[0 * 4 + 0]).toBeCloseTo(0, 6);
    expect(fd[1 * 4 + 1]).toBeCloseTo(0, 6);

    // Every entry finite (no NaN from a zero/near-zero step).
    for (const v of fd) expect(Number.isFinite(v)).toBe(true);

    // Magnus couples vx and vy (F_M ⊥ v_rel), so the velocity block is no
    // longer symmetric the way the pure-drag Jacobian is.
    expect(fd[2 * 4 + 3]).not.toBeCloseTo(fd[3 * 4 + 2]!, 6);
  });

  it("gives a sensible scaled step at y=0 (no NaN/Inf from a zero step size)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const fd = new Float64Array(16);
    finiteDifferenceJacobian(model, 0, new Float64Array(4), ctx, fd);

    for (const v of fd) expect(Number.isFinite(v)).toBe(true);
  });
});
