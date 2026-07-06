import { describe, expect, it } from "vitest";
import { sutherlandViscosity } from "./viscosity.js";
import { SUTHERLAND } from "./units.js";

describe("sutherlandViscosity", () => {
  it("eta(288.15 K) = 1.789e-5 +/- 1%", () => {
    const eta = sutherlandViscosity(288.15);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("equals etaRef exactly at Tref", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases monotonically with temperature", () => {
    const temps = [200, 250, 288.15, 300, 400, 500];
    for (let i = 1; i < temps.length; i++) {
      expect(sutherlandViscosity(temps[i]!)).toBeGreaterThan(sutherlandViscosity(temps[i - 1]!));
    }
  });
});
