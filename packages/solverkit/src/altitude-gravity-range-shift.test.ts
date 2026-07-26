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
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";

/**
 * P4.02: altitude-dependent gravity (eq. 3.3) as a `UniformGravity` toggle.
 * This task's literal validation criterion: a long-range cannonball's range
 * shifts by the predicted sign and order once the toggle is enabled.
 *
 * Predicted sign: g(y) = g0*(R/(R+y))^2 is weaker above sea level, so a
 * trajectory that spends most of its flight well off the ground experiences
 * a smaller average downward pull than the constant-g0 model assumes, stays
 * airborne longer, and lands farther out -- range must increase.
 *
 * Predicted order: the leading-order relative change in g at apex height h
 * is ~2h/R (binomial expansion of (R/(R+h))^2), and the range shift is a
 * fraction of that (only the ballistic phase near apex sees the full
 * weakening; ascent/descent near the ground see almost none). For this
 * scenario h ~= 4.1 km, R = 6.371e6 m, so 2h/R ~= 1.3e-3 -- the measured
 * relative range shift should land within an order of magnitude of that,
 * i.e. comfortably inside [1e-4, 1e-2].
 */
function landingRange(altitudeDependent: boolean): number {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(9.80665, altitudeDependent),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 5,
    radius: 0.1,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()]);

  const speed = 400; // m/s -- long-range cannonball muzzle velocity
  const angle = Math.PI / 4;
  const y0 = new Float64Array([0, 0, speed * Math.cos(angle), speed * Math.sin(angle)]);
  const stepper = createDormandPrince54Stepper();

  const report = integrate(
    model,
    ctx,
    y0,
    [0, 200],
    { stepper: stepper.info.id, h: 0.1, maxSteps: 200_000 },
    stepper,
  );

  expect(report.status).toBe("ok");
  return report.yFinal[0]!;
}

describe("altitude-dependent gravity: long-range cannonball range shift (P4.02, eq. 3.3)", () => {
  it("increases range vs. constant gravity, by an amount of order 2*apexHeight/earthRadius", () => {
    const rangeConstant = landingRange(false);
    const rangeAltitude = landingRange(true);

    expect(rangeAltitude).toBeGreaterThan(rangeConstant);

    const relativeShift = (rangeAltitude - rangeConstant) / rangeConstant;
    expect(relativeShift).toBeGreaterThan(1e-4);
    expect(relativeShift).toBeLessThan(1e-2);
  });
});
