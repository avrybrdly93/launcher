import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";

const DIM = 4;

describe("createFiniteDifferenceJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.47),
  });
  const environment = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
  );
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const ctx = createEvalContext(environment, params);

  const analytic = createGravityQuadraticDragJacobian(params, environment);
  const fd = createFiniteDifferenceJacobian(model, ctx);

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

  it("matches the P1.22 analytic Jacobian where available (gravity + quadratic drag)", () => {
    for (const state of states) {
      const y = new Float64Array(state);
      const jAnalytic = new Float64Array(DIM * DIM);
      const jFd = new Float64Array(DIM * DIM);
      analytic(0, y, jAnalytic);
      fd(0, y, jFd);

      for (let k = 0; k < DIM * DIM; k++) {
        expect(jFd[k]).toBeCloseTo(jAnalytic[k]!, 5);
      }
    }
  });

  it("does not mutate the input state", () => {
    const y = new Float64Array([10, 20, 5, -5]);
    const before = Float64Array.from(y);
    const out = new Float64Array(DIM * DIM);
    fd(0, y, out);
    expect(y).toEqual(before);
  });

  it("produces a finite Jacobian for a model with no analytic counterpart (Magnus + spin)", () => {
    const cl = new SaturatingLiftCoefficient();
    const spinParams = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: cl,
      spin: 180,
    });
    const magnusModel = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const magnusCtx = createEvalContext(environment, spinParams);
    const fdMagnus = createFiniteDifferenceJacobian(magnusModel, magnusCtx);

    const out = new Float64Array(DIM * DIM);
    fdMagnus(0, new Float64Array([0, 0, 25, 10]), out);

    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    // Kinematic rows are exact regardless of force model.
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 6);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 6);
  });
});
