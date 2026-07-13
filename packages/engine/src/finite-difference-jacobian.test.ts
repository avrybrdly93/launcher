import { describe, expect, it } from "vitest";
import type { EvalContext } from "./eval-context.js";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import type { Model } from "./model.js";
import { createFdJacobianScratch, finiteDifferenceJacobian } from "./finite-difference-jacobian.js";

/** dy/dt = A*y for a fixed 3x3 matrix A — any Model works, this one has zero curvature so central FD is exact. */
function createLinearModel(a: readonly (readonly number[])[]): Model {
  return {
    dim: 3,
    channels: [
      { name: "y0", unit: "1" },
      { name: "y1", unit: "1" },
      { name: "y2", unit: "1" },
    ],
    rhs(_t, y, out, _ctx) {
      for (let row = 0; row < 3; row++) {
        out[row] = a[row]![0]! * y[0]! + a[row]![1]! * y[1]! + a[row]![2]! * y[2]!;
      }
    },
  };
}

describe("finiteDifferenceJacobian", () => {
  it("recovers the exact matrix for a linear model (zero curvature, only roundoff)", () => {
    const a = [
      [1, -2, 0.5],
      [0, 3, -1],
      [4, 0, -0.25],
    ];
    const model = createLinearModel(a);
    const ctx = {} as EvalContext; // the mock rhs never touches ctx
    const y = new Float64Array([2, -3, 5]);
    const out = new Float64Array(9);

    finiteDifferenceJacobian(model, 0, y, ctx, out);

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        expect(out[row * 3 + col]).toBeCloseTo(a[row]![col]!, 6);
      }
    }
  });

  it("is model-agnostic: works identically via a reused scratch buffer", () => {
    const a = [
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, -5],
    ];
    const model = createLinearModel(a);
    const ctx = {} as EvalContext;
    const y = new Float64Array([1, 1, 1]);
    const out = new Float64Array(9);
    const scratch = createFdJacobianScratch(model.dim);

    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);
    finiteDifferenceJacobian(model, 0, y, ctx, out, scratch);

    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[3]).toBeCloseTo(-1, 6);
    expect(out[8]).toBeCloseTo(-5, 6);
  });

  it("matches P1.22's analytic jacobian where available (gravity + quadratic drag, no Magnus)", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [100, 10, -1.5, -1.5],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
    ];

    for (const state of states) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = new Float64Array(16);
      finiteDifferenceJacobian(model, 0, y, ctx, fd);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(fd[i]! - analytic[i]!)).toBeLessThan(1e-6);
      }
    }
  });
});
