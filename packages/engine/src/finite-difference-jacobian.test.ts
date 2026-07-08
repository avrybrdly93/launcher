import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { gravityQuadraticDragJacobian } from "./jacobian.js";
import { finiteDifferenceJacobian } from "./finite-difference-jacobian.js";

const N = 4;

describe("finiteDifferenceJacobian", () => {
  const mass = 0.145;
  const radius = 0.0366;
  const cd = new ConstantCd(0.47);

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });

  // Same fixture states used for the P1.20/P1.22 tests.
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

  it("matches the P1.22 analytic Jacobian where available", () => {
    for (const state of states) {
      const y = new Float64Array(state);

      const analyticCtx = createEvalContext(env, params);
      const analytic = new Float64Array(N * N);
      gravityQuadraticDragJacobian(0, y, analyticCtx, analytic);

      const fdCtx = createEvalContext(env, params);
      const fd = new Float64Array(N * N);
      finiteDifferenceJacobian(model, 0, y, fdCtx, fd);

      for (let idx = 0; idx < N * N; idx++) {
        expect(Math.abs(analytic[idx]! - fd[idx]!)).toBeLessThan(1e-5);
      }
    }
  });

  it("does not mutate the input state", () => {
    const y = new Float64Array([1, 2, 3, 4]);
    const untouched = new Float64Array(y);
    const ctx = createEvalContext(env, params);
    const out = new Float64Array(N * N);
    finiteDifferenceJacobian(model, 0, y, ctx, out);
    expect(y).toEqual(untouched);
  });
});
