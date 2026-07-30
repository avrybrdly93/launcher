import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  FunctionTerrain,
  G_STD,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";

/**
 * P4.15 (blueprint §8.2 "permanent reference library", "Incline range
 * (drag-free)"): R = 2v0^2 cosθ sin(θ-α) / (g cos^2 α), where α is the
 * incline angle from horizontal (positive = ground rising ahead of the
 * launch point) and θ is the launch angle above horizontal. Derivation:
 * intersecting the drag-free parabola y = x tanθ - g x^2/(2 v0^2 cos^2 θ)
 * with the incline y = x tanα gives the horizontal landing coordinate
 * x = 2 v0^2 cos^2 θ (tanθ - tanα)/g; substituting
 * tanθ - tanα = sin(θ-α)/(cosθ cosα) and R = x/cosα (the slope-distance,
 * matching what the formula measures) yields the closed form above. At
 * α=0 this reduces to the familiar flat-ground R = v0^2 sin(2θ)/g. This is
 * the entry of the analytical-comparison table (§8.2) that validates
 * ground-impact events against a *sloped* `Terrain` (the P4.13/solved
 * `groundHeightResidual` machinery already covers piecewise-PCHIP terrain
 * in `sloped-terrain-impact.test.ts`; this closes the loop with an
 * independent closed-form check rather than a self-consistency check
 * against the terrain's own `height()`).
 */
function inclineRangeFormula(v0: number, theta: number, alpha: number): number {
  return (2 * v0 * v0 * Math.cos(theta) * Math.sin(theta - alpha)) / (G_STD * Math.cos(alpha) ** 2);
}

/** Integrates a drag-free launch to ground impact on a straight incline of angle `alpha`, returning the impact range measured along the slope (matching what {@link inclineRangeFormula} computes). */
function simulateInclineRange(v0: number, theta: number, alpha: number): number {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(G_STD, false),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const terrain = new FunctionTerrain((x) => x * Math.tan(alpha));
  const model = createPlanarProjectileModel([new GravityForce()], terrain);

  const y0 = new Float64Array([0, 0, v0 * Math.cos(theta), v0 * Math.sin(theta)]);
  const stepper = createDormandPrince54Stepper();

  const report = integrate(
    model,
    ctx,
    y0,
    [0, 100],
    { stepper: stepper.info.id, h: 0.01, rtol: 1e-13, atol: 1e-14, maxSteps: 200_000 },
    stepper,
  );

  expect(report.status).toBe("ok");
  expect(report.tFinal).toBeLessThan(100);

  const [xImpact] = report.yFinal;
  return xImpact! / Math.cos(alpha);
}

describe("sloped-ground analytic check: drag-free range on incline formula (P4.15, §8.2)", () => {
  it("matches R = 2v0^2 cosθ sin(θ-α) / (g cos^2 α) on a rising incline", () => {
    const v0 = 50;
    const theta = (50 * Math.PI) / 180;
    const alpha = (15 * Math.PI) / 180;

    const expected = inclineRangeFormula(v0, theta, alpha);
    const actual = simulateInclineRange(v0, theta, alpha);

    expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-9);
  });

  it("matches the same formula on a falling incline (negative α)", () => {
    const v0 = 80;
    const theta = (35 * Math.PI) / 180;
    const alpha = (-20 * Math.PI) / 180;

    const expected = inclineRangeFormula(v0, theta, alpha);
    const actual = simulateInclineRange(v0, theta, alpha);

    expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-9);
  });

  it("reduces to the flat-ground range v0^2 sin(2θ)/g at α=0", () => {
    const v0 = 60;
    const theta = (40 * Math.PI) / 180;

    const expected = (v0 * v0 * Math.sin(2 * theta)) / G_STD;
    const actual = simulateInclineRange(v0, theta, 0);

    expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-9);
  });
});
