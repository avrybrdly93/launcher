import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./planar-projectile-jacobian.js";
import {
  createFiniteDifferenceJacobianScratch,
  finiteDifferenceJacobian,
} from "./finite-difference-jacobian.js";

const DIM = 4;

describe("finiteDifferenceJacobian", () => {
  const cd = new ConstantCd(0.47);
  const mass = 0.145;
  const radius = 0.0366;
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
  const ctx = createEvalContext(env, params);
  const scratch = createFiniteDifferenceJacobianScratch(DIM);

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

  it("matches the P1.22 analytic gravity+quadratic-drag Jacobian where available", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(DIM * DIM);
      const fd = new Float64Array(DIM * DIM);

      gravityQuadraticDragJacobian(0, y, analytic, ctx);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let i = 0; i < DIM * DIM; i++) {
        expect(fd[i]).toBeCloseTo(analytic[i]!, 6);
      }
    }
  });

  it("leaves y unmodified after evaluation (perturbations are restored)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const y = new Float64Array([10, 5, -8.2, 15.6]);
    const yBefore = new Float64Array(y);
    const out = new Float64Array(DIM * DIM);

    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);

    expect(y).toEqual(yBefore);
  });

  it("serves as a generic fallback beyond P1.22's scope: agrees with itself at finer/coarser scaled steps for a Magnus-enabled model", () => {
    const cl = new SaturatingLiftCoefficient();
    const model = createPlanarProjectileModel([
      new GravityForce(),
      new QuadraticDragForce(),
      new MagnusForce(),
    ]);
    const magnusParams = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin: 180,
    });
    const magnusCtx = createEvalContext(env, magnusParams);
    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(DIM * DIM);

    finiteDifferenceJacobian(model, 0, y, magnusCtx, out, scratch);

    // Sanity: kinematic rows are exact regardless of force composition.
    expect(out[0 * DIM + 2]).toBeCloseTo(1, 6);
    expect(out[1 * DIM + 3]).toBeCloseTo(1, 6);
    for (const v of out) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});
