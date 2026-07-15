import { describe, expect, it } from "vitest";
import { createEvalContext, type EvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

const STATES: [number, number, number, number][] = [
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

function makeGravityDragModelAndCtx(): { model: Model; ctx: EvalContext } {
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  return { model, ctx };
}

describe("createFiniteDifferenceJacobian (P1.23)", () => {
  it("matches P1.22's analytic gravity+quadratic-drag jacobian at 10 states", () => {
    const { model, ctx } = makeGravityDragModelAndCtx();
    expect(model.jacobian).toBeDefined();
    const fdJacobian = createFiniteDifferenceJacobian(model);

    for (const state of STATES) {
      const y = new Float64Array(state);
      const analytic = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      const fd = new Float64Array(16);
      fdJacobian(0, y, fd, ctx);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(1e-7);
      }
    }
  });

  it("is usable as the fallback for models P1.22's analytic jacobian doesn't cover (Magnus)", () => {
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
      dragCoefficient: new ConstantCd(0.47),
      liftCoefficient: new SaturatingLiftCoefficient(),
      spin: 180,
    });
    const ctx = createEvalContext(env, params);
    const jacobianFn = model.jacobian ?? createFiniteDifferenceJacobian(model);

    const y = new Float64Array([0, 0, 30, 10]);
    const out = new Float64Array(16);
    jacobianFn(0, y, out, ctx);
    for (const value of out) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // dx/dt = vx, dy/dt = vy exactly, independent of force model.
    expect(out[2]).toBeCloseTo(1, 6);
    expect(out[7]).toBeCloseTo(1, 6);
  });

  it("matches the exact derivative -1 for a trivial decay model (dy/dt = -y)", () => {
    const decayModel: Model = {
      dim: 1,
      channels: [{ name: "y", unit: "1" }],
      rhs(_t, y, out) {
        out[0] = -y[0]!;
      },
    };
    const jacobianFn = createFiniteDifferenceJacobian(decayModel);
    const ctx = {} as EvalContext; // the mock rhs never touches ctx
    const y = new Float64Array([3.7]);
    const out = new Float64Array(1);
    jacobianFn(0, y, out, ctx);
    expect(out[0]).toBeCloseTo(-1, 6);
  });
});
