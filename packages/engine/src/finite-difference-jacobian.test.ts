import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createJacobianScratch, finiteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";
import type { EvalContext } from "./eval-context.js";

describe("finiteDifferenceJacobian", () => {
  it("matches P1.22's analytic Jacobian (gravity + quadratic drag) to 1e-7 at 10 states", () => {
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
    const scratch = createJacobianScratch(model.dim);
    const dim = model.dim;

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.5, -0.8],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(dim * dim);
      const fd = new Float64Array(dim * dim);
      model.jacobian!(0, y, analytic, ctx);
      finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

      for (let i = 0; i < dim * dim; i++) {
        expect(Math.abs(fd[i]! - analytic[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("stays usable when no analytic Jacobian is available (Magnus included)", () => {
    const mass = 0.145;
    const radius = 0.0366;
    const spin = 180;
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
      mass,
      radius,
      dragCoefficient: cd,
      liftCoefficient: cl,
      spin,
    });
    const ctx = createEvalContext(env, params);
    const scratch = createJacobianScratch(model.dim);

    const y = new Float64Array([0, 10, 20, 5]);
    const fd = new Float64Array(model.dim * model.dim);
    finiteDifferenceJacobian(model, 0, y, ctx, fd, scratch);

    for (const v of fd) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // d(x-dot)/d(vx) and d(y-dot)/d(vy) are exact structural 1s regardless of forces.
    expect(fd[0 * model.dim + 2]).toBeCloseTo(1, 6);
    expect(fd[1 * model.dim + 3]).toBeCloseTo(1, 6);
  });

  it("matches a hand-differentiable mock model exactly (scaled-step sanity check)", () => {
    // f(y) = (-2*y0, 3*y1^2) -> J = diag(-2, 6*y1)
    const mockModel: Model = {
      dim: 2,
      channels: [
        { name: "a", unit: "1" },
        { name: "b", unit: "1" },
      ],
      rhs(_t: number, y: Float64Array, out: Float64Array): void {
        out[0] = -2 * y[0]!;
        out[1] = 3 * y[1]! * y[1]!;
      },
    };
    const ctx = {} as EvalContext;
    const scratch = createJacobianScratch(mockModel.dim);
    const y = new Float64Array([5, -3]);
    const fd = new Float64Array(4);
    finiteDifferenceJacobian(mockModel, 0, y, ctx, fd, scratch);

    expect(fd[0]).toBeCloseTo(-2, 6);
    expect(fd[1]).toBeCloseTo(0, 6);
    expect(fd[2]).toBeCloseTo(0, 6);
    expect(fd[3]).toBeCloseTo(6 * -3, 5);
  });
});
