import { describe, expect, it } from "vitest";
import { ISA } from "@ballista/engine";
import { computeDensityAltitudeComparison } from "./density-altitude.js";

describe("computeDensityAltitudeComparison (P4.29 density-altitude exercise)", () => {
  it("resolves the soccer-ball preset from PROJECTILE_ASSETS, not a duplicated literal", () => {
    const result = computeDensityAltitudeComparison();
    expect(result.presetId).toBe("soccer-ball");
    expect(result.presetName).toContain("Soccer ball");
    expect(result.muzzleSpeed).toBeGreaterThan(0);
  });

  it("fires the sea-level shot at ISA sea-level density", () => {
    const result = computeDensityAltitudeComparison();
    expect(result.seaLevel.altitude).toBe(0);
    // IsaTroposphereAtmosphere derives rho from p0/(Rs*T0) (ideal-gas law), which is
    // consistent with but not bit-identical to the separately-tabulated ISA.rho0 constant.
    expect(result.seaLevel.rhoAir).toBeCloseTo(ISA.rho0, 4);
  });

  it("fires the high-altitude shot at 2000 m with measurably thinner air", () => {
    const result = computeDensityAltitudeComparison();
    expect(result.highAltitude.altitude).toBe(2000);
    expect(result.highAltitude.rhoAir).toBeLessThan(result.seaLevel.rhoAir);
    // ISA troposphere: rho falls off by roughly 20% over the first 2 km.
    const ratio = result.highAltitude.rhoAir / result.seaLevel.rhoAir;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.85);
  });

  it("measures a positive range increase at altitude (thinner air, less drag)", () => {
    const result = computeDensityAltitudeComparison();
    expect(result.seaLevel.range).toBeGreaterThan(0);
    expect(result.highAltitude.range).toBeGreaterThan(result.seaLevel.range);
    expect(result.rangeIncrease).toBeCloseTo(result.highAltitude.range - result.seaLevel.range, 10);
    expect(result.rangeIncrease).toBeGreaterThan(0);
    expect(result.rangeIncreasePercent).toBeGreaterThan(0);
    expect(result.rangeIncreasePercent).toBeCloseTo(
      (result.rangeIncrease / result.seaLevel.range) * 100,
      10,
    );
  });

  it("is deterministic across repeated calls", () => {
    const a = computeDensityAltitudeComparison();
    const b = computeDensityAltitudeComparison();
    expect(a.seaLevel.range).toBe(b.seaLevel.range);
    expect(a.highAltitude.range).toBe(b.highAltitude.range);
  });
});
