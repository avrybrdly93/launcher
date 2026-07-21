import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createStepResult } from "./types.js";
import { VerletStepper } from "./verlet-stepper.js";

/**
 * P2.49: Stormer-Verlet is time-reversible when acceleration depends only on
 * position (gravity-only, per §4.8 -- velocity-dependent forces like drag
 * break exact symplecticity/reversibility regardless of variant, same
 * caveat verlet-stepper.ts documents for energy conservation). Running N
 * steps forward with +h then N steps backward with -h from the same
 * stepper recurrence should land back on y0 to within floating-point
 * roundoff, not just "small drift" -- that's the actual content of the
 * reversibility property, distinct from (and stronger than) the bounded-
 * energy-error property verlet-stepper.test.ts already covers.
 */
describe("VerletStepper time-reversibility on gravity-only (P2.49, §4.8)", () => {
  function gravityOnlyFixture() {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);
    return { model, ctx };
  }

  for (const variant of ["velocity", "position"] as const) {
    it(`${variant} variant: integrating forward then backward returns to y0 within 1e-9 over 100 steps`, () => {
      const { model, ctx } = gravityOnlyFixture();
      const y0 = new Float64Array([0, 0, 20, 50]);
      const h = 0.01;
      const nSteps = 100;

      const stepper = new VerletStepper(variant);
      stepper.init(model, ctx);
      const out = createStepResult(4);

      const y = Float64Array.from(y0);
      let t = 0;
      for (let i = 0; i < nSteps; i++) {
        stepper.step(t, y, h, out);
        y.set(out.yNext);
        t += h;
      }

      // Sanity: forward integration must have actually moved the state
      // (otherwise "returns to y0" would be a vacuous no-op check).
      let forwardDisplacement = 0;
      for (let i = 0; i < y.length; i++) {
        forwardDisplacement += (y[i]! - y0[i]!) ** 2;
      }
      expect(Math.sqrt(forwardDisplacement)).toBeGreaterThan(1);

      for (let i = 0; i < nSteps; i++) {
        stepper.step(t, y, -h, out);
        y.set(out.yNext);
        t -= h;
      }

      let err = 0;
      for (let i = 0; i < y.length; i++) {
        err += (y[i]! - y0[i]!) ** 2;
      }
      expect(Math.sqrt(err)).toBeLessThan(1e-9);
    });
  }
});
