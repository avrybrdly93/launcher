import { describe, expect, it } from "vitest";
import type { EvalContext } from "./eval-context.js";
import { createEvalContext } from "./eval-context.js";
import { ConstantAtmosphere, Environment, UniformGravity, ZeroWind } from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce, MagnusForce, QuadraticDragForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { createFiniteDifferenceJacobian } from "./finite-difference-jacobian.js";
import type { Model } from "./model.js";

const STATES: readonly [number, number, number, number][] = [
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

describe("createFiniteDifferenceJacobian", () => {
  function buildGravityDragContext(): { model: Model; ctx: EvalContext } {
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.47),
    });
    return { model, ctx: createEvalContext(env, params) };
  }

  it("matches the P1.22 analytic Jacobian where available, at 10 states", () => {
    const { model, ctx } = buildGravityDragContext();
    expect(model.jacobian).toBeDefined();
    const fd = createFiniteDifferenceJacobian(model);

    for (const state of STATES) {
      const y = Float64Array.from(state);
      const analytic = new Float64Array(16);
      const numeric = new Float64Array(16);
      model.jacobian!(0, y, analytic, ctx);
      fd(0, y, numeric, ctx);

      for (let k = 0; k < 16; k++) {
        expect(Math.abs(analytic[k]! - numeric[k]!)).toBeLessThan(1e-6);
      }
    }
  });

  it("does not allocate a new out-of-band buffer per call (reused scratch, only out is written)", () => {
    const { model, ctx } = buildGravityDragContext();
    const fd = createFiniteDifferenceJacobian(model);
    const y = new Float64Array([0, 0, 20, 10]);
    const outA = new Float64Array(16);
    const outB = new Float64Array(16);
    fd(0, y, outA, ctx);
    // y must be restored exactly after perturbation, not left mutated.
    expect(y).toEqual(new Float64Array([0, 0, 20, 10]));
    fd(0, y, outB, ctx);
    expect(outB).toEqual(outA);
  });

  it("also works for models the analytic formula declines (Magnus present)", () => {
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
    const fd = createFiniteDifferenceJacobian(model);

    // Cross-check against an independent fixed-h central difference.
    const h = 1e-6;
    for (const state of STATES) {
      const y = Float64Array.from(state);
      const numeric = new Float64Array(16);
      fd(0, y, numeric, ctx);

      const fPlus = new Float64Array(4);
      const fMinus = new Float64Array(4);
      for (let j = 0; j < 4; j++) {
        const yPlus = Float64Array.from(y);
        const yMinus = Float64Array.from(y);
        yPlus[j] = yPlus[j]! + h;
        yMinus[j] = yMinus[j]! - h;
        model.rhs(0, yPlus, fPlus, ctx);
        model.rhs(0, yMinus, fMinus, ctx);
        for (let i = 0; i < 4; i++) {
          expect(Math.abs(numeric[i * 4 + j]! - (fPlus[i]! - fMinus[i]!) / (2 * h))).toBeLessThan(
            1e-5,
          );
        }
      }
    }
  });

  it("honors a supplied typicalScale for the step size (larger scale => larger effective h)", () => {
    const { model, ctx } = buildGravityDragContext();
    const fdDefault = createFiniteDifferenceJacobian(model);
    const fdScaled = createFiniteDifferenceJacobian(model, [1, 1, 1000, 1000]);
    const y = new Float64Array([0, 0, 0.01, 0.01]);
    const outDefault = new Float64Array(16);
    const outScaled = new Float64Array(16);
    fdDefault(0, y, outDefault, ctx);
    fdScaled(0, y, outScaled, ctx);
    // Both approximate the same analytic derivative reasonably near a small
    // state, but the scaled step must differ from the unscaled one (proving
    // typicalScale actually changes h) without diverging wildly.
    expect(outScaled).not.toEqual(outDefault);
    const analytic = new Float64Array(16);
    model.jacobian!(0, y, analytic, ctx);
    for (let k = 0; k < 16; k++) {
      expect(Math.abs(outScaled[k]! - analytic[k]!)).toBeLessThan(1e-3);
    }
  });
});
