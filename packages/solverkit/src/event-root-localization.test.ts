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
  type EventSpec,
} from "@ballista/engine";
import { scanStepForEvents } from "./event-detection.js";
import { localizeEventRoot } from "./event-root-localization.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { createStepResult } from "./types.js";

const SCALAR_EVENT: EventSpec = {
  name: "scalar",
  g: (_t: number, y: Float64Array) => y[0]!,
};

describe("localizeEventRoot", () => {
  it("localizes an ordinary linear crossing to near machine precision", () => {
    const t0 = 0;
    const t1 = 1;
    const y0 = new Float64Array([-1]);
    const y1 = new Float64Array([1]);
    const interpolant = (theta: number, out: Float64Array) => {
      out[0] = -1 + 2 * theta;
    };
    const scratch = new Float64Array(1);

    const [candidate] = scanStepForEvents([SCALAR_EVENT], t0, y0, t1, y1, interpolant, scratch);
    const root = localizeEventRoot(candidate!, t0, t1, y0, y1, interpolant, scratch);

    expect(root.t).toBeCloseTo(0.5, 13);
    expect(Math.abs(root.g)).toBeLessThan(1e-12);
    expect(root.converged).toBe(true);
    // Returned y must be a copy, independent of the caller's scratch buffer.
    scratch[0] = 12345;
    expect(root.y[0]).not.toBe(12345);
  });

  it("localizes a root at an exact bracket endpoint without calling the interpolant there", () => {
    const t0 = 0;
    const t1 = 1;
    const y0 = new Float64Array([0]);
    const y1 = new Float64Array([1]);
    const interpolant = (theta: number, out: Float64Array) => {
      out[0] = theta;
    };
    const scratch = new Float64Array(1);

    const [candidate] = scanStepForEvents([SCALAR_EVENT], t0, y0, t1, y1, interpolant, scratch);
    const root = localizeEventRoot(candidate!, t0, t1, y0, y1, interpolant, scratch);

    expect(root.t).toBe(0);
    expect(root.iterations).toBe(0);
    expect(root.y).toEqual(y0);
  });

  /**
   * P2.33's literal validation criterion: for a drag-free (gravity-only)
   * launch from y=0, the ground-impact event time has the closed form
   * t_impact = 2*v0*sin(theta)/g. A single large DOPRI5 step spanning launch
   * to well past impact reproduces this exactly (to machine precision)
   * regardless of step size, since the true drag-free trajectory is a
   * degree-2 polynomial in t and DOPRI5's stages (order 5) reproduce any
   * polynomial trajectory of degree <= 5 exactly (P2.30's dense-output test
   * notes the same fact) -- so the root Brent localizes on the dense output
   * should match the closed form to the tolerance below, not just to the
   * dense-output interpolant's own nominal O(h^4) accuracy.
   */
  it("drag-free impact time matches the analytic 2*v0*sin(theta)/g to 1e-12", () => {
    const g = 9.80665;
    const v0 = 20;
    const launchAngle = Math.PI / 4;
    const vx0 = v0 * Math.cos(launchAngle);
    const vy0 = v0 * Math.sin(launchAngle);
    const analyticImpactTime = (2 * v0 * Math.sin(launchAngle)) / g;

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);
    const groundImpact = model.events!.find((e) => e.name === "ground-impact")!;

    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const t0 = 0;
    const h = 1.5 * analyticImpactTime;
    const y0 = new Float64Array([0, 0, vx0, vy0]);
    const out = createStepResult(4);
    stepper.step(t0, y0, h, out);
    const y1 = out.yNext;
    const t1 = t0 + h;

    const scratch = new Float64Array(4);

    const candidates = scanStepForEvents(
      [groundImpact],
      t0,
      y0,
      t1,
      y1,
      stepper.interpolant!,
      scratch,
    );
    expect(candidates).toHaveLength(1);

    const root = localizeEventRoot(candidates[0]!, t0, t1, y0, y1, stepper.interpolant!, scratch);

    expect(root.converged).toBe(true);
    expect(Math.abs(root.t - analyticImpactTime)).toBeLessThan(1e-12);
    // At the localized root the projectile should be back at y=0 (flat terrain).
    expect(Math.abs(root.y[1]!)).toBeLessThan(1e-9);
  });
});
