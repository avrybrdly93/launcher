import { describe, expect, it } from "vitest";
import {
  apexHeightEstimate,
  dimensionlessPi,
  dragRelaxationTimeLinear,
  terminalVelocityQuadratic,
  type CharacteristicEnvironment,
} from "./characteristic-scales.js";
import { ConstantCd, TabulatedReynoldsCd, SMOOTH_SPHERE_CD_TABLE } from "./drag-coefficient.js";
import { createSphericalProjectileParams } from "./projectile-params.js";
import { G_STD, ISA, sutherlandViscosity } from "./units.js";

const ISA_ENV: CharacteristicEnvironment = { rho: ISA.rho0, eta: sutherlandViscosity(ISA.T0) };

/** Belly-to-earth skydiver: mass 75 kg, Cd*A ~= 0.42 m^2 (a commonly cited "drag area" for this pose). */
const SKYDIVER = createSphericalProjectileParams({
  mass: 75,
  radius: Math.sqrt(0.7 / Math.PI), // area = 0.7 m^2
  dragCoefficient: new ConstantCd(0.6),
});

describe("terminalVelocityQuadratic", () => {
  it("gives a skydiver-like preset v_T in the 50-60 m/s band", () => {
    const vT = terminalVelocityQuadratic(SKYDIVER, ISA_ENV);
    expect(vT).toBeGreaterThanOrEqual(50);
    expect(vT).toBeLessThanOrEqual(60);
  });

  it("converges to a finite positive value for a tabulated (drag-crisis) Cd curve", () => {
    const params = createSphericalProjectileParams({
      mass: 4.12,
      radius: 0.05,
      dragCoefficient: new TabulatedReynoldsCd(SMOOTH_SPHERE_CD_TABLE),
    });
    const vT = terminalVelocityQuadratic(params, ISA_ENV);
    expect(Number.isFinite(vT)).toBe(true);
    expect(vT).toBeGreaterThan(0);
  });

  it("matches the closed form (3.10) exactly for constant Cd", () => {
    const params = createSphericalProjectileParams({
      mass: 0.145,
      radius: 0.0366,
      dragCoefficient: new ConstantCd(0.35),
    });
    const vT = terminalVelocityQuadratic(params, ISA_ENV);
    const expected = Math.sqrt((2 * params.mass * G_STD) / (ISA_ENV.rho * 0.35 * params.area));
    expect(vT).toBeCloseTo(expected, 6);
  });
});

describe("dimensionlessPi", () => {
  it("is 1 at v0 = v_T by construction (Π = (v0/v_T)^2)", () => {
    const vT = terminalVelocityQuadratic(SKYDIVER, ISA_ENV);
    expect(dimensionlessPi(SKYDIVER, ISA_ENV, vT)).toBeCloseTo(1, 6);
  });

  it("scales with v0^2 for constant Cd", () => {
    const params = createSphericalProjectileParams({
      mass: 7.26,
      radius: 0.06,
      dragCoefficient: new ConstantCd(0.47),
    });
    const piAt10 = dimensionlessPi(params, ISA_ENV, 10);
    const piAt20 = dimensionlessPi(params, ISA_ENV, 20);
    expect(piAt20 / piAt10).toBeCloseTo(4, 6);
  });
});

describe("dragRelaxationTimeLinear", () => {
  it("matches the closed form tau = m / (6 pi eta R)", () => {
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 1,
      dragCoefficient: new ConstantCd(0.47),
    });
    const tau = dragRelaxationTimeLinear(params, ISA_ENV);
    expect(tau).toBeCloseTo(1 / (6 * Math.PI * ISA_ENV.eta * 1), 10);
  });

  it("is extremely small (stiff) for a micron-scale dust grain", () => {
    const radius = 5e-6;
    const mass = (4 / 3) * Math.PI * Math.pow(radius, 3) * 2000;
    const params = createSphericalProjectileParams({
      mass,
      radius,
      dragCoefficient: new ConstantCd(0.5),
    });
    const tau = dragRelaxationTimeLinear(params, ISA_ENV);
    expect(tau).toBeLessThan(1e-3);
  });
});

describe("apexHeightEstimate", () => {
  it("matches the drag-free closed form v_y0^2/(2g)", () => {
    expect(apexHeightEstimate(20)).toBeCloseTo((20 * 20) / (2 * G_STD), 12);
    expect(apexHeightEstimate(0)).toBe(0);
  });

  it("honors a non-default g", () => {
    expect(apexHeightEstimate(10, 1.62)).toBeCloseTo(100 / (2 * 1.62), 12);
  });
});
