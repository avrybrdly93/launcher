import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createGravityQuadraticDragJacobian } from "./jacobian.js";
import { createFiniteDifferenceJacobian } from "./fd-jacobian.js";

describe("createFiniteDifferenceJacobian", () => {
  it("matches the P1.22 analytic Jacobian where available, at 10 states", () => {
    const cd = new ConstantCd(0.47);
    const mass = 0.145;
    const radius = 0.0366;

    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const environment = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(),
      new ZeroWind(),
    );
    const params = createSphericalProjectileParams({ mass, radius, dragCoefficient: cd });
    const ctx = createEvalContext(environment, params);

    const analyticJacobian = createGravityQuadraticDragJacobian(environment, params);
    const fdJacobianFn = createFiniteDifferenceJacobian(model, ctx);

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

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      const fd = new Float64Array(16);
      analyticJacobian(0, y, analytic);
      fdJacobianFn(0, y, fd);

      for (let idx = 0; idx < 16; idx++) {
        expect(Math.abs(analytic[idx]! - fd[idx]!)).toBeLessThan(1e-5);
      }
    }
  });

  it("works for any state dimension by only calling model.rhs", () => {
    const dim = 3;
    const model = {
      dim,
      channels: [],
      rhs(_t: number, y: Float64Array, out: Float64Array): void {
        // A simple nonlinear system: dy0 = y1^2, dy1 = y0*y2, dy2 = -y1.
        out[0] = y[1]! * y[1]!;
        out[1] = y[0]! * y[2]!;
        out[2] = -y[1]!;
      },
    };
    const ctx = createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity()),
      createSphericalProjectileParams({ mass: 1, radius: 1, dragCoefficient: new ConstantCd(0) }),
    );
    const fdJacobianFn = createFiniteDifferenceJacobian(model, ctx);

    const y = new Float64Array([1.5, -2.0, 0.5]);
    const out = new Float64Array(dim * dim);
    fdJacobianFn(0, y, out);

    // Exact analytic Jacobian of the toy system above.
    const expected = [0, 2 * y[1]!, 0, y[2]!, 0, y[0]!, 0, -1, 0];
    for (let idx = 0; idx < 9; idx++) {
      expect(Math.abs(out[idx]! - expected[idx]!)).toBeLessThan(1e-6);
    }
  });
});
