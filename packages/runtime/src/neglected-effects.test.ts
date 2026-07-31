import { describe, expect, it } from "vitest";
import { ISA } from "@ballista/engine";
import { computeNeglectedEffects } from "./neglected-effects.js";

describe("computeNeglectedEffects (P4.20 'how big are the effects we ignore?' exercise)", () => {
  it("resolves the soccer-ball preset from PROJECTILE_ASSETS, not a duplicated literal", () => {
    const result = computeNeglectedEffects();
    expect(result.presetId).toBe("soccer-ball");
    expect(result.presetName).toContain("Soccer ball");
    expect(result.mass).toBeCloseTo(0.43, 10);
    expect(result.radius).toBeCloseTo(0.11, 10);
    expect(result.volume).toBeCloseTo((4 / 3) * Math.PI * 0.11 ** 3, 10);
    expect(result.rhoAir).toBe(ISA.rho0);
  });

  it("matches the P1.16/P4.20 validation band (~1.0-1.6% of weight)", () => {
    const result = computeNeglectedEffects();
    expect(result.buoyancyToWeightRatio).toBeGreaterThan(0.01);
    expect(result.buoyancyToWeightRatio).toBeLessThan(0.016);
  });
});
