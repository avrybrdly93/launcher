import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  PiecewisePchipTerrain,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";

function buildModel(controlPoints: { x: number; y: number }[]) {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const terrain = new PiecewisePchipTerrain(controlPoints);
  const model = createPlanarProjectileModel([new GravityForce()], terrain);
  return { model, ctx, terrain };
}

describe("ground-impact event against a P4.13 piecewise-PCHIP terrain (§3.9, §4.9)", () => {
  it("solves y=h(x) on a rising slope, not just y=0", () => {
    // A monotonic incline: h(x) = 0.15*x through 5 control points -- far
    // enough from linear-in-x-only that a naive "impact at y=0" check would
    // land in the wrong place, but still simple enough to hand-verify.
    const { model, ctx } = buildModel([
      { x: 0, y: 0 },
      { x: 20, y: 3 },
      { x: 40, y: 6 },
      { x: 60, y: 9 },
      { x: 80, y: 12 },
    ]);

    const y0 = new Float64Array([0, 5, 25, 5]);
    const stepper = createDormandPrince54Stepper();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 20],
      { stepper: stepper.info.id, h: 0.1, rtol: 1e-10, atol: 1e-12, maxSteps: 5000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    // Landed strictly on the incline (not at the flat-ground y=0 that a
    // terrain-blind solver would report), and short of the tspan end.
    expect(report.tFinal).toBeLessThan(20);
    const [xImpact, yImpact] = report.yFinal;
    expect(yImpact).toBeGreaterThan(0);
    // The event root satisfies g_gnd = y - h(x) = 0 to tight tolerance --
    // "impact event solves y=h(x) on slope", this task's validation
    // criterion, not merely "lands at some y close to the slope".
    expect(Math.abs(yImpact! - 0.15 * xImpact!)).toBeLessThan(1e-6);
  });

  it("solves y=h(x) at the true PCHIP-interpolated point between control points, not the linear secant", () => {
    // A concave terrain arc between x=0 and x=100 (control points only at
    // the ends and middle) -- PCHIP's cubic Hermite segment between (0,0)
    // and (50,10) is *not* the straight secant, so this cross-checks the
    // impact point against the terrain's own `height()`, not a hand-derived
    // formula, which would silently pass even if the event solver quietly
    // used the wrong terrain representation.
    const { model, ctx, terrain } = buildModel([
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 5 },
    ]);

    const y0 = new Float64Array([0, 3, 15, 6]);
    const stepper = createDormandPrince54Stepper();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 20],
      { stepper: stepper.info.id, h: 0.1, rtol: 1e-10, atol: 1e-12, maxSteps: 5000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBeLessThan(20);
    const [xImpact, yImpact] = report.yFinal;
    expect(Math.abs(yImpact! - terrain.height(xImpact!))).toBeLessThan(1e-6);
  });

  it("exercises a grazing case: a bump entirely within one fixed step is caught even though both step endpoints read as still airborne", () => {
    // A narrow bump (control points 0 at x=6 and x=9, peak 1.5 at x=7.5)
    // sitting inside a single h=0.5s RK4 step of a flight whose g_gnd =
    // y-h(x) is positive at *both* step endpoints (t=0: g=1, t=0.5: g=0.6)
    // -- a naive g(t0)*g(t1)<0 endpoint check would report no crossing at
    // all across the whole step. Only the driver's 3-interior-point
    // grazing guard (§4.9, P2.32) samples close enough to the bump (at
    // theta=0.75, x=7.5) to see g dip negative and catch the impact.
    const { model, ctx, terrain } = buildModel([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 7.5, y: 1.5 },
      { x: 9, y: 0 },
      { x: 10, y: 0 },
    ]);

    const y0 = new Float64Array([0, 1.0, 20, 1.6516]);
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());

    // Precondition: confirm this really is a grazing case invisible to a
    // naive endpoint-only check, not merely "some impact happens somewhere
    // in the tspan".
    const gAtStart = y0[1]! - terrain.height(y0[0]!);
    const g = (t: number) => {
      const y = 1.0 + 1.6516 * t - 0.5 * 9.80665 * t * t;
      const x = 20 * t;
      return y - terrain.height(x);
    };
    expect(gAtStart * g(0.5)).toBeGreaterThan(0);

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 0.5],
      { stepper: stepper.info.id, h: 0.5, maxSteps: 10 },
      stepper,
    );

    // The terminal ground-impact event fired mid-step, well short of the
    // requested 0.5s tspan end -- proof the graze was caught, not skipped.
    expect(report.status).toBe("ok");
    expect(report.tFinal).toBeLessThan(0.5);
    expect(report.tFinal).toBeGreaterThan(0);

    const [xImpact, yImpact] = report.yFinal;
    expect(Math.abs(yImpact! - terrain.height(xImpact!))).toBeLessThan(1e-9);
  });
});
