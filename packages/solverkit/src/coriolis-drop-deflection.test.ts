import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  CoriolisForce,
  EARTH_ANGULAR_VELOCITY,
  Environment,
  GravityForce,
  UniformGravity,
  UniformRotation,
  ZeroWind,
  createEvalContext,
  createSpatialProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";

/**
 * P4.27 (blueprint §8.2, table row): "Coriolis force option: -2m*Omega x v
 * with latitude param", validation criterion "eastward deflection of
 * vertical drop matches (1/3)*Omega*g*t^3*cos(phi) to 1%".
 *
 * This is the classic drop-deflection problem: an object released from rest
 * (no initial horizontal or lateral velocity) falls under gravity alone,
 * plus the Coriolis pseudo-force from Earth's rotation. To leading order in
 * Omega, the vertical velocity is the ordinary free-fall v_y(t) = -g*t, and
 * (per `spatial-projectile-model.ts`'s "coriolis" rhs case derivation) the
 * only Coriolis component that survives when vx=vz=0 is the lateral one,
 * Fz = -2*m*Omega*cos(phi)*vy, which integrates twice to
 * z(t) = (1/3)*Omega*g*t^3*cos(phi) -- positive (this engine's +z = local
 * East, per the ENU decomposition documented on `CoriolisForce`).
 *
 * The simulation here uses the *full* nonlinear Coriolis force (not a
 * first-order truncation), so it also picks up the true solution's O(Omega^2)
 * self-consistent corrections (e.g. the tiny vz that develops feeds back into
 * ax/ay). At Earth's real Omega those corrections are of relative size
 * ~(Omega*t)^2 ~ 5e-7 for the t=10s drop used below -- utterly negligible
 * against the 1% tolerance the validation criterion asks for.
 */
function analyticDropDeflection(omega: number, g: number, t: number, latitudeRad: number): number {
  return (1 / 3) * omega * g * t ** 3 * Math.cos(latitudeRad);
}

/** Simulated lateral (z) position at t=tEnd for a from-rest vertical drop from height y0. */
function simulateDropZ(omega: number, latitudeRad: number, y0: number, tEnd: number): number {
  const mass = 1;
  const radius = 0.05;
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(),
    new ZeroWind(),
    new UniformRotation(latitudeRad, omega),
  );
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createSpatialProjectileModel([new GravityForce(), new CoriolisForce()]);

  const y0State = new Float64Array([0, y0, 0, 0, 0, 0]); // at rest: vx=vy=vz=0
  const stepper = createDormandPrince54Stepper();
  const report = integrate(
    model,
    ctx,
    y0State,
    [0, tEnd],
    { stepper: stepper.info.id, rtol: 1e-12, atol: 1e-13, maxSteps: 200_000 },
    stepper,
  );

  expect(report.status).toBe("ok");
  expect(report.tFinal).toBe(tEnd); // never truncated by the ground-impact event
  return report.yFinal[2]!; // z channel
}

describe("Coriolis drop deflection (P4.27, blueprint §8.2)", () => {
  const g = 9.80665; // UniformGravity's default (G_STD, units.ts)
  const y0 = 2000; // m -- well above the ~490m a 10s free fall covers, so impact never truncates tEnd
  const tEnd = 10; // s

  it("matches (1/3)*Omega*g*t^3*cos(phi) to 1% at 45N (validation criterion)", () => {
    const latitude = Math.PI / 4; // 45 deg N
    const actual = simulateDropZ(EARTH_ANGULAR_VELOCITY, latitude, y0, tEnd);
    const expected = analyticDropDeflection(EARTH_ANGULAR_VELOCITY, g, tEnd, latitude);

    expect(expected).toBeGreaterThan(0); // sanity: formula itself predicts eastward (+z)
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.01);
  });

  it("deflects eastward (+z), matching this engine's ENU axis convention", () => {
    const actual = simulateDropZ(EARTH_ANGULAR_VELOCITY, Math.PI / 4, y0, tEnd);
    expect(actual).toBeGreaterThan(0);
  });

  it("matches the formula at the equator too (cos(0)=1, the largest deflection)", () => {
    const actual = simulateDropZ(EARTH_ANGULAR_VELOCITY, 0, y0, tEnd);
    const expected = analyticDropDeflection(EARTH_ANGULAR_VELOCITY, g, tEnd, 0);
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.01);
  });

  it("deflects eastward in the Southern Hemisphere too -- cos(phi) is even, unlike P4.28's sin(phi)-driven hemisphere flip for horizontal motion", () => {
    const north = simulateDropZ(EARTH_ANGULAR_VELOCITY, Math.PI / 4, y0, tEnd);
    const south = simulateDropZ(EARTH_ANGULAR_VELOCITY, -Math.PI / 4, y0, tEnd);
    expect(south).toBeGreaterThan(0);
    expect(south).toBeCloseTo(north, 6);
  });

  it("with omega=0 (no rotation registered), lateral deflection is exactly zero", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createSpatialProjectileModel([new GravityForce(), new CoriolisForce()]);
    const y0State = new Float64Array([0, y0, 0, 0, 0, 0]);
    const stepper = createDormandPrince54Stepper();
    const report = integrate(
      model,
      ctx,
      y0State,
      [0, tEnd],
      { stepper: stepper.info.id, rtol: 1e-12, atol: 1e-13, maxSteps: 200_000 },
      stepper,
    );
    expect(report.yFinal[2]).toBe(0);
  });
});
