import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import {
  ClassicalRK4Stepper,
  ExplicitEulerStepper,
  MidpointRK2Stepper,
  measureWorkPrecision,
  nRHSAtTargetError,
  runWorkPrecisionStudy,
  workPrecisionStudyToJSON,
  type WorkPrecisionCurve,
} from "@ballista/solverkit";
import { referenceSolution } from "./reference-solution.js";

/**
 * Baseball-like gravity+quadratic-drag scenario: genuinely nonlinear, no
 * closed-form solution, so ground truth comes from P2.18's
 * Richardson-extrapolated RK4 reference solution rather than an analytic
 * formula -- exactly the composition P2.18 exists to enable.
 */
function buildScenario() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const y0 = Float64Array.from([0, 0, 30, 20]);
  const tspan: readonly [number, number] = [0, 1];
  return { model, ctx, y0, tspan };
}

describe("work-precision harness (P2.19)", () => {
  it("Euler/RK2/RK4 curves ordered as expected at error 1e-6", () => {
    const { model, ctx, y0, tspan } = buildScenario();
    const truth = referenceSolution(model, ctx, y0, tspan, 0.0005);
    const yExact = () => truth;

    const eulerHs = [
      0.01, 0.005, 0.0025, 0.00125, 0.000625, 0.0003125, 0.00015625, 0.0001, 0.00005,
    ];
    const rk2Hs = [0.02, 0.01, 0.005, 0.0025, 0.00125, 0.000625, 0.0003125];
    const rk4Hs = [0.05, 0.02, 0.01, 0.005, 0.0025];

    const eulerCurve = measureWorkPrecision(
      () => new ExplicitEulerStepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      eulerHs,
    );
    const rk2Curve = measureWorkPrecision(
      () => new MidpointRK2Stepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      rk2Hs,
    );
    const rk4Curve = measureWorkPrecision(
      () => new ClassicalRK4Stepper(),
      model,
      ctx,
      y0,
      tspan,
      yExact,
      rk4Hs,
    );

    expect(eulerCurve.method).toBe("explicit-euler");
    expect(rk2Curve.method).toBe("midpoint-rk2");
    expect(rk4Curve.method).toBe("classical-rk4");

    // Every curve's error must shrink monotonically as nRHS grows -- a
    // well-posed work-precision curve, not measurement noise.
    for (const curve of [eulerCurve, rk2Curve, rk4Curve]) {
      for (let i = 1; i < curve.points.length; i++) {
        expect(curve.points[i]!.error).toBeLessThan(curve.points[i - 1]!.error);
      }
    }

    // The pedagogical point of a work-precision plot (§4): at a fixed
    // target accuracy, higher-order methods cost dramatically fewer rhs
    // evaluations. Interpolate/extrapolate each curve's log-log fit to the
    // rhs count needed to reach 1e-6 error.
    const targetError = 1e-6;
    const nRHSEuler = nRHSAtTargetError(eulerCurve, targetError);
    const nRHSRK2 = nRHSAtTargetError(rk2Curve, targetError);
    const nRHSRK4 = nRHSAtTargetError(rk4Curve, targetError);

    expect(nRHSEuler).toBeGreaterThan(nRHSRK2);
    expect(nRHSRK2).toBeGreaterThan(nRHSRK4);
    // Not just ordered but by the expected margins: RK2 needs an order of
    // magnitude fewer evals than Euler, RK4 an order of magnitude fewer
    // still, at equal accuracy.
    expect(nRHSEuler).toBeGreaterThan(100 * nRHSRK2);
    expect(nRHSRK2).toBeGreaterThan(10 * nRHSRK4);
  });

  it("workPrecisionStudyToJSON produces JSON that round-trips a full study", () => {
    const { model, ctx, y0, tspan } = buildScenario();
    const truth = referenceSolution(model, ctx, y0, tspan, 0.0005);
    const yExact = () => truth;
    const hs = [0.01, 0.005, 0.0025];

    const curves = runWorkPrecisionStudy(
      [
        () => new ExplicitEulerStepper(),
        () => new MidpointRK2Stepper(),
        () => new ClassicalRK4Stepper(),
      ],
      model,
      ctx,
      y0,
      tspan,
      yExact,
      hs,
    );

    const json = workPrecisionStudyToJSON(curves);
    const parsed = JSON.parse(json) as WorkPrecisionCurve[];

    expect(parsed).toEqual(curves);
    expect(parsed.map((c) => c.method)).toEqual([
      "explicit-euler",
      "midpoint-rk2",
      "classical-rk4",
    ]);
    for (const curve of parsed) {
      expect(curve.points.length).toBe(hs.length);
      for (const point of curve.points) {
        expect(Number.isFinite(point.h)).toBe(true);
        expect(Number.isFinite(point.nRHS)).toBe(true);
        expect(Number.isFinite(point.error)).toBe(true);
      }
    }
  });
});
