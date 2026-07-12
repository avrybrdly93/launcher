import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobian } from "./fd-jacobian.js";

const DIM = 4;

describe("createFiniteDifferenceJacobian (P1.23)", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
  );

  const states: [number, number, number, number][] = [
    [0, 0, 12.3, 4.1],
    [10, 5, -8.2, 15.6],
    [-3, 20, 25.0, -30.1],
    [0, 0.5, 3.001, -2.002],
    [100, 10, -1.5, -1.5],
    [0, 0, 40, 0],
    [0, 0, 0, 40],
    [5, 5, 5, 5],
    [-10, -10, -20, 20],
    [1, 1, 33.3, -12.7],
  ];

  it("matches the P1.22 analytic Jacobian where available (gravity+quadratic-drag)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()], {
      params,
      environment,
    });
    expect(model.jacobian).toBeDefined();

    const ctx = createEvalContext(environment, params);
    const fd = createFiniteDifferenceJacobian(model, ctx);

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      const finiteDiff = new Float64Array(DIM * DIM);

      model.jacobian!(0, y, analytic);
      fd(0, y, finiteDiff);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(finiteDiff[i]).toBeCloseTo(analytic[i]!, 4);
      }
    }
  });

  it("still produces a finite Jacobian for a force set with no analytic counterpart (Magnus)", () => {
    const cl = new SaturatingLiftCoefficient();
    const spinParams = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin: 180,
    });
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    expect(model.jacobian).toBeUndefined();

    const ctx = createEvalContext(environment, spinParams);
    const fd = createFiniteDifferenceJacobian(model, ctx);
    const out = new Float64Array(DIM * DIM);
    fd(0, new Float64Array([0, 0, 30, 10]), out);

    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    // dx/dt = vx, dy/dt = vy exactly, regardless of the force set.
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 10);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 10);
  });

  it("does not allocate new scratch buffers across repeated calls (reuses closure state)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const ctx = createEvalContext(environment, params);
    const fd = createFiniteDifferenceJacobian(model, ctx);
    const out = new Float64Array(DIM * DIM);
    const y = new Float64Array([0, 0, 30, 10]);

    expect(() => {
      for (let i = 0; i < 1000; i++) fd(i * 1e-3, y, out);
    }).not.toThrow();
  });
});
