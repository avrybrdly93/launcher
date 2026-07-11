import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { evaluateJacobian, FiniteDifferenceJacobian } from "./finite-difference-jacobian.js";

// Same deterministic states as planar-projectile-model.test.ts's P1.22 spec.
const STATES: [number, number, number, number][] = [
  [0, 0, 12.3, 4.1],
  [10, 5, -8.2, 15.6],
  [-3, 20, 25.0, -30.1],
  [100, 10, -1.5, -1.5],
  [0, 0, 40, 0],
  [0, 0, 0, 40],
  [5, 5, 5, 5],
  [-10, -10, -20, 20],
  [1, 1, 33.3, -12.7],
  [2, -2, 3, 3],
];

describe("FiniteDifferenceJacobian (P1.23)", () => {
  it("matches the P1.22 analytic jacobian where one is available (gravity + quadratic drag)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    expect(model.jacobian).toBeTypeOf("function");

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fd = new FiniteDifferenceJacobian(model.dim);

    for (const [x, yPos, vx, vy] of STATES) {
      const y = new Float64Array([x, yPos, vx, vy]);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const numeric = new Float64Array(16);
      fd.evaluate(model, 0, y, ctx, numeric);

      for (let k = 0; k < 16; k++) {
        expect(numeric[k]).toBeCloseTo(analytic[k]!, 6);
      }
    }
  });

  it("produces a finite, sensible jacobian for a model with no analytic one (Magnus)", () => {
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
    const fd = new FiniteDifferenceJacobian(model.dim);

    const y = new Float64Array([0, 0, 25, -10]);
    const numeric = new Float64Array(16);
    fd.evaluate(model, 0, y, ctx, numeric);

    for (const v of numeric) expect(Number.isFinite(v)).toBe(true);
    // Kinematic rows are exact regardless of force composition: dx/dt = vx, dy/dt = vy.
    expect(numeric[0 * 4 + 2]).toBeCloseTo(1, 6);
    expect(numeric[1 * 4 + 3]).toBeCloseTo(1, 6);
  });

  it("evaluateJacobian prefers the analytic jacobian when available", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const fd = new FiniteDifferenceJacobian(model.dim);

    const y = new Float64Array([0, 0, 20, -5]);
    const analytic = new Float64Array(16);
    model.jacobian!(0, y, analytic, ctx);

    const viaHelper = new Float64Array(16);
    evaluateJacobian(model, 0, y, ctx, viaHelper, fd);

    expect(viaHelper).toEqual(analytic);
  });

  it("evaluateJacobian falls back to FD when no analytic jacobian is provided", () => {
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
    const fd = new FiniteDifferenceJacobian(model.dim);

    const y = new Float64Array([0, 0, 20, -5]);
    const direct = new Float64Array(16);
    fd.evaluate(model, 0, y, ctx, direct);

    const viaHelper = new Float64Array(16);
    evaluateJacobian(model, 0, y, ctx, viaHelper, fd);

    expect(viaHelper).toEqual(direct);
  });
});
