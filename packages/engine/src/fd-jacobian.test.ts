import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFdJacobianScratch, fdJacobian } from "./fd-jacobian.js";

describe("fdJacobian", () => {
  it("matches the P1.22 analytic gravity+quadratic-drag jacobian at 10 states", () => {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    expect(model.jacobian).toBeDefined();

    const scratch = createFdJacobianScratch(model.dim);
    const analytic = new Float64Array(model.dim * model.dim);
    const fd = new Float64Array(model.dim * model.dim);

    const states: [number, number, number, number][] = [
      [0, 0, 12.3, 4.1],
      [10, 5, -8.2, 15.6],
      [-3, 20, 25.0, -30.1],
      [0, 0.5, 0.5, -0.3],
      [100, 10, -1.5, -1.5],
      [0, 0, 40, 0],
      [0, 0, 0, 40],
      [5, 5, 5, 5],
      [-10, -10, -20, 20],
      [1, 1, 33.3, -12.7],
    ];

    for (const state of states) {
      const y = Float64Array.from(state);
      model.jacobian!(0, y, analytic, ctx);
      fdJacobian(model, 0, y, fd, ctx, scratch);

      for (let k = 0; k < analytic.length; k++) {
        expect(fd[k]).toBeCloseTo(analytic[k]!, 6);
      }
    }
  });

  it("matches the exact derivative of a simple decay model dy/dt = -y", () => {
    const model = {
      dim: 1,
      rhs(_t: number, y: Float64Array, out: Float64Array, _ctx: EvalContext) {
        out[0] = -y[0]!;
      },
    };
    const scratch = createFdJacobianScratch(1);
    const out = new Float64Array(1);
    fdJacobian(model, 0, Float64Array.from([3.7]), out, {} as EvalContext, scratch);
    expect(out[0]).toBeCloseTo(-1, 8);
  });

  it("reuses scratch buffers without allocating new ones across calls", () => {
    const scratch = createFdJacobianScratch(2);
    const refs = {
      yPlus: scratch.yPlus,
      yMinus: scratch.yMinus,
      fPlus: scratch.fPlus,
      fMinus: scratch.fMinus,
    };
    const model = {
      dim: 2,
      rhs(_t: number, y: Float64Array, out: Float64Array, _ctx: EvalContext) {
        out[0] = y[1]!;
        out[1] = -y[0]!;
      },
    };
    const out = new Float64Array(4);
    for (let i = 0; i < 5; i++) {
      fdJacobian(model, 0, Float64Array.from([1, 2]), out, {} as EvalContext, scratch);
    }
    expect(scratch.yPlus).toBe(refs.yPlus);
    expect(scratch.yMinus).toBe(refs.yMinus);
    expect(scratch.fPlus).toBe(refs.fPlus);
    expect(scratch.fMinus).toBe(refs.fMinus);
  });
});
