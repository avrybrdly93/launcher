import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  CoriolisForce,
  EARTH_ANGULAR_VELOCITY_RAD_S,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createSpatialProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";

/**
 * P4.27 (blueprint §8.2): "Coriolis force option: -2m*Omega x v with
 * latitude param", validation criterion "eastward deflection of vertical
 * drop matches (1/3)*Omega*g*t^3*cos(lat) to 1%".
 *
 * This is the classic Coriolis-deflection-of-a-falling-body result. Derivation
 * (matches `spatial-projectile-model.ts`'s CoriolisParams doc, which decomposes
 * Earth's rotation vector in this model's (x=North, y=Up, z=East) local axes as
 * Omega_local = Omega_E*(cos(lat), sin(lat), 0)): for a body released from
 * rest and falling under gravity alone (no drag), v(t) ~= (0, -g*t, 0) to
 * leading order in Omega (the Coriolis-induced horizontal velocity is itself
 * O(Omega), so its feedback into the fall rate is only O(Omega^2), utterly
 * negligible at Omega_E ~ 7.3e-5 rad/s over the timescales here). Then:
 *
 *   fz = 2*m*Omega_E*(sinLat*vx - cosLat*vy) = 2*m*Omega_E*cosLat*g*t
 *   az = 2*Omega_E*g*t*cosLat
 *   vz(t) = Omega_E*g*t^2*cosLat            (integrating az from 0)
 *   z(t)  = (1/3)*Omega_E*g*t^3*cosLat      (integrating vz from 0)
 *
 * a positive (eastward, per the axis convention) deflection in the Northern
 * hemisphere (cosLat > 0) -- the textbook result. Computed here directly from
 * closed form (no independent hand-rolled integrator needed, unlike the
 * crosswind task's small-perturbation estimate, since this closed form *is*
 * the reference the backlog item names) and compared against
 * `createSpatialProjectileModel`'s actual simulated trajectory.
 */
describe("Coriolis force: eastward deflection of a vertical drop (P4.27, §8.2)", () => {
  const mass = 1;
  const radius = 0.05;
  const g = 9.80665;
  const dropHeight = 2000; // m, well above the ~490m free-fall distance at t=10s
  const tEnd = 10; // s

  function simulateDropZ(latitudeRad: number, tEnd: number): number {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createSpatialProjectileModel(
      [new GravityForce(), new CoriolisForce()],
      undefined,
      undefined,
      { latitudeRad },
    );

    const y0 = new Float64Array([0, dropHeight, 0, 0, 0, 0]);
    const stepper = createDormandPrince54Stepper();
    const report = integrate(
      model,
      ctx,
      y0,
      [0, tEnd],
      { stepper: stepper.info.id, rtol: 1e-13, atol: 1e-14, maxSteps: 200_000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(tEnd); // never truncated by ground impact (dropHeight >> free-fall distance)
    return report.yFinal[2]!; // z channel
  }

  it("eastward deflection matches (1/3)*Omega*g*t^3*cos(lat) to 1% at 45 deg N", () => {
    const latitudeRad = Math.PI / 4;
    const analytic = (1 / 3) * EARTH_ANGULAR_VELOCITY_RAD_S * g * tEnd ** 3 * Math.cos(latitudeRad);
    const actual = simulateDropZ(latitudeRad, tEnd);

    expect(analytic).toBeGreaterThan(0); // sanity: Northern-hemisphere drop deflects "eastward" (+z)
    expect(Math.abs(actual - analytic) / Math.abs(analytic)).toBeLessThan(0.01);
  });

  it("matches to 1% across a range of latitudes, including the equator and a Southern-hemisphere site", () => {
    for (const latitudeRad of [0, Math.PI / 6, Math.PI / 3, -Math.PI / 4]) {
      const analytic =
        (1 / 3) * EARTH_ANGULAR_VELOCITY_RAD_S * g * tEnd ** 3 * Math.cos(latitudeRad);
      const actual = simulateDropZ(latitudeRad, tEnd);
      expect(Math.abs(actual - analytic) / Math.abs(analytic)).toBeLessThan(0.01);
    }
  });

  it("deflection scales as t^3 (halving t should cut deflection roughly eightfold)", () => {
    const latitudeRad = Math.PI / 4;
    const zFull = simulateDropZ(latitudeRad, tEnd);
    const zHalf = simulateDropZ(latitudeRad, tEnd / 2);
    expect(zFull / zHalf).toBeCloseTo(8, 1);
  });

  it("at the pole (lat=90deg), deflection is exactly zero (cos(lat)=0)", () => {
    const actual = simulateDropZ(Math.PI / 2, tEnd);
    expect(actual).toBeCloseTo(0, 6);
  });
});
