import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  MagnusForce,
  QuadraticDragForce,
  SaturatingLiftCoefficient,
  UniformGravity,
  UniformWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { referenceSolution } from "./reference-solution.js";

/**
 * Gravity + quadratic drag + Magnus lift + crosswind: no closed-form
 * solution exists for this system (Magnus and drag both couple v_x/v_y
 * nonlinearly), which is exactly the kind of scenario P2.18 exists for.
 */
function buildNoAnalyticsScenario() {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new UniformWind(3, 0),
  );
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
    liftCoefficient: new SaturatingLiftCoefficient(),
    spin: 180,
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([
    new GravityForce(),
    new QuadraticDragForce(),
    new MagnusForce(),
  ]);
  const y0 = Float64Array.from([0, 0, 30, 10]);
  const tspan: readonly [number, number] = [0, 1];
  return { model, ctx, y0, tspan };
}

describe("referenceSolution (P2.18)", () => {
  it("self-consistency: two independent reference resolutions agree to 1e-10", () => {
    const { model, ctx, y0, tspan } = buildNoAnalyticsScenario();

    const refA = referenceSolution(model, ctx, y0, tspan, 0.002);
    const refB = referenceSolution(model, ctx, y0, tspan, 0.001);

    expect(refA.length).toBe(refB.length);
    for (let i = 0; i < refA.length; i++) {
      expect(Math.abs(refA[i]! - refB[i]!)).toBeLessThan(1e-10);
    }
  });

  it("is tighter than either raw RK4 run it Richardson-combines", () => {
    const { model, ctx, y0, tspan } = buildNoAnalyticsScenario();
    const h = 0.01;

    // A very fine "truth" run to measure error against -- fine enough that
    // its own error is far below anything else measured here.
    const truth = referenceSolution(model, ctx, y0, tspan, 0.0005);
    const extrapolated = referenceSolution(model, ctx, y0, tspan, h);

    const l2 = (a: Float64Array, b: Float64Array) => {
      let sumSq = 0;
      for (let i = 0; i < a.length; i++) {
        const d = a[i]! - b[i]!;
        sumSq += d * d;
      }
      return Math.sqrt(sumSq);
    };

    expect(l2(extrapolated, truth)).toBeLessThan(1e-6);
  });
});
