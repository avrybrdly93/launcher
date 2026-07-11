import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { finiteDifferenceJacobian, modelJacobian } from "./jacobian.js";

const TEN_STATES: [number, number, number, number][] = [
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

describe("gravityQuadraticDragJacobian", () => {
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

  it("is wired onto the model for gravity + quadratic drag", () => {
    expect(model.jacobian).toBeDefined();
  });

  it("matches central finite differences to 1e-7 at 10 states", () => {
    for (const state of TEN_STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);

      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, 1e-5);

      for (let i = 0; i < 16; i++) {
        expect(analytic[i]).toBeCloseTo(fd[i]!, 7);
      }
    }
  });

  it("returns the exact zero drag-Jacobian block at v_rel = 0 (the C1-not-C2 kink, §3.8)", () => {
    const y = new Float64Array([0, 0, 0, 0]);
    const out = new Float64Array(16);
    model.jacobian!(0, y, out, ctx);

    expect(out).toEqual(new Float64Array([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]));
  });

  it("is left unset when Magnus is present (no closed form yet, P1.23 covers the fallback)", () => {
    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(magnusModel.jacobian).toBeUndefined();
  });
});

describe("finiteDifferenceJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);

  it("matches P1.22's analytic Jacobian to its own default step, at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

    for (const state of TEN_STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);

      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd);

      for (let i = 0; i < 16; i++) {
        expect(fd[i]).toBeCloseTo(analytic[i]!, 6);
      }
    }
  });

  it("still produces a finite, sane Jacobian when Magnus makes the analytic form unavailable", () => {
    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const magnusParams = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const magnusCtx = createEvalContext(env, magnusParams);
    const y = new Float64Array([0, 0, 30, 10]);

    const fd = new Float64Array(16);
    finiteDifferenceJacobian(magnusModel, 0, y, magnusCtx, fd);

    // Structural rows are exact regardless of which forces are active.
    expect(fd[0 * 4 + 2]).toBeCloseTo(1, 6);
    expect(fd[1 * 4 + 3]).toBeCloseTo(1, 6);
    for (const value of fd) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("modelJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  const y = new Float64Array([0, 0, 20, 10]);

  it("dispatches to the analytic Jacobian when the model declares one", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const viaDispatch = new Float64Array(16);
    const direct = new Float64Array(16);

    modelJacobian(model, 0, y, ctx, viaDispatch);
    model.jacobian!(0, y, direct, ctx);

    expect(viaDispatch).toEqual(direct);
  });

  it("falls back to finite differences when the model has no analytic Jacobian", () => {
    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const viaDispatch = new Float64Array(16);
    const direct = new Float64Array(16);

    modelJacobian(magnusModel, 0, y, ctx, viaDispatch);
    finiteDifferenceJacobian(magnusModel, 0, y, ctx, direct);

    expect(viaDispatch).toEqual(direct);
  });
});
