import { describe, expect, it } from "vitest";
import { createEvalContext } from "./eval-context.js";
import {
  ConstantAtmosphere,
  Environment,
  IsaTroposphereAtmosphere,
  UniformGravity,
  ZeroWind,
} from "./environment.js";
import { ConstantCd } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { GravityForce } from "./forces.js";
import { createPlanarProjectileModel } from "./planar-projectile-model.js";
import { ISA, SUTHERLAND } from "./units.js";

describe("EvalContext derived channels (Re, Mach)", () => {
  it("matches a hand-computed Reynolds/Mach for a golf-ball drive to 1e-12", () => {
    // Golf ball: diameter 42.7 mm, driven at 70 m/s through ISA sea-level air.
    const radius = 0.02135;
    const speed = 70;
    const model = createPlanarProjectileModel([new GravityForce()]);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 0.0459,
      radius,
      dragCoefficient: new ConstantCd(0.25),
    });
    const ctx = createEvalContext(env, params);
    const y = new Float64Array([0, 0, speed, 0]);
    const out = new Float64Array(4);
    model.rhs(0, y, out, ctx);

    const diameter = 2 * radius;
    const expectedRe = (ISA.rho0 * speed * diameter) / SUTHERLAND.etaRef;
    const speedOfSound = Math.sqrt(1.4 * ISA.Rs * ISA.T0);
    const expectedMach = speed / speedOfSound;

    expect(Math.abs(ctx.re - expectedRe) / expectedRe).toBeLessThan(1e-12);
    expect(ctx.mach).toBeCloseTo(expectedMach, 12);
  });
});

/**
 * P4.03: eta(T) and c(T) are wired into EvalContext through ctx.env
 * (populated by whatever Atmosphere is in play), so Re and Mach become
 * altitude-aware for free once the atmosphere model itself is altitude-aware
 * (P4.01's IsaTroposphereAtmosphere). This task's literal validation
 * criterion: Mach at a high-altitude preset exceeds sea-level Mach for the
 * same speed -- true because c(T) = sqrt(gamma*Rs*T) falls as the lapsed
 * temperature falls with altitude, shrinking the denominator of M = v/c.
 */
function machAt(altitudeM: number, speed: number): number {
  const model = createPlanarProjectileModel([new GravityForce()]);
  const env = new Environment(new IsaTroposphereAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.0459,
    radius: 0.02135,
    dragCoefficient: new ConstantCd(0.25),
  });
  const ctx = createEvalContext(env, params);
  const y = new Float64Array([0, altitudeM, speed, 0]);
  const out = new Float64Array(4);
  model.rhs(0, y, out, ctx);
  return ctx.mach;
}

describe("EvalContext altitude-aware Mach (P4.03, validation criterion)", () => {
  it("Mach at a high-altitude (8 km) preset exceeds sea-level Mach for the same speed", () => {
    const speed = 250;
    const seaLevelMach = machAt(0, speed);
    const highAltitudeMach = machAt(8000, speed);
    expect(highAltitudeMach).toBeGreaterThan(seaLevelMach);
  });

  it("matches the hand-computed c(T) ratio at 8 km to 1e-12", () => {
    const speed = 250;
    const highAltitudeMach = machAt(8000, speed);
    const lapsedT = ISA.T0 - ISA.lapseRate * 8000;
    const expectedSpeedOfSound = Math.sqrt(1.4 * ISA.Rs * lapsedT);
    expect(highAltitudeMach).toBeCloseTo(speed / expectedSpeedOfSound, 12);
  });
});
