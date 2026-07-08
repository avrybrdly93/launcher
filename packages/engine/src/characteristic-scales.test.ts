import { describe, expect, it } from "vitest";
import { G_STD, ISA, SUTHERLAND } from "./units.js";
import {
  computeAssetCharacteristicScales,
  computeCharacteristicScales,
} from "./characteristic-scales.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("computeCharacteristicScales", () => {
  it("v_T for a skydiver-like preset falls in 50-60 m/s", () => {
    const scales = computeCharacteristicScales({
      mass: 80,
      area: 0.7,
      cd: 0.6,
      rho: ISA.rho0,
      g: G_STD,
      v0: 0,
      launchAngleRad: 0,
    });
    expect(scales.terminalVelocity).toBeGreaterThanOrEqual(50);
    expect(scales.terminalVelocity).toBeLessThanOrEqual(60);
  });

  it("matches eq. (3.10) exactly", () => {
    const mass = 0.145;
    const area = Math.PI * 0.0366 * 0.0366;
    const cd = 0.3;
    const rho = ISA.rho0;
    const scales = computeCharacteristicScales({
      mass,
      area,
      cd,
      rho,
      g: G_STD,
      v0: 10,
      launchAngleRad: 0,
    });
    const expected = Math.sqrt((2 * mass * G_STD) / (rho * cd * area));
    expect(scales.terminalVelocity).toBeCloseTo(expected, 12);
  });

  it("dragTimescale = v_T / g", () => {
    const scales = computeCharacteristicScales({
      mass: 1,
      area: 0.01,
      cd: 0.47,
      rho: ISA.rho0,
      g: G_STD,
      v0: 20,
      launchAngleRad: Math.PI / 4,
    });
    expect(scales.dragTimescale).toBeCloseTo(scales.terminalVelocity / G_STD, 12);
  });

  it("Pi = (v0/v_T)^2", () => {
    const scales = computeCharacteristicScales({
      mass: 1,
      area: 0.01,
      cd: 0.47,
      rho: ISA.rho0,
      g: G_STD,
      v0: 20,
      launchAngleRad: Math.PI / 4,
    });
    expect(scales.pi).toBeCloseTo((20 / scales.terminalVelocity) ** 2, 12);
  });

  it("apexEstimate matches the drag-free formula v0^2*sin^2(theta)/(2g)", () => {
    const v0 = 30;
    const theta = Math.PI / 6;
    const scales = computeCharacteristicScales({
      mass: 1,
      area: 0.01,
      cd: 0.47,
      rho: ISA.rho0,
      g: G_STD,
      v0,
      launchAngleRad: theta,
    });
    const expected = (v0 * v0 * Math.sin(theta) ** 2) / (2 * G_STD);
    expect(scales.apexEstimate).toBeCloseTo(expected, 12);
  });
});

describe("computeAssetCharacteristicScales (nondimensional groups as scenario metadata)", () => {
  it("Pi(shot put) < 0.1 < Pi(table-tennis ball)", () => {
    const environment = { rho: ISA.rho0, g: G_STD, eta: SUTHERLAND.etaRef };
    const shotPut = PROJECTILE_ASSETS.find((a) => a.id === "shot-put")!;
    const tableTennisBall = PROJECTILE_ASSETS.find((a) => a.id === "table-tennis-ball")!;

    const shotPutScales = computeAssetCharacteristicScales(shotPut, environment, 14);
    const ttBallScales = computeAssetCharacteristicScales(tableTennisBall, environment, 10);

    expect(shotPutScales.pi).toBeLessThan(0.1);
    expect(ttBallScales.pi).toBeGreaterThan(0.1);
    expect(shotPutScales.pi).toBeLessThan(ttBallScales.pi);
  });
});
