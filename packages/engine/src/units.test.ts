import { describe, expect, it } from "vitest";
import { SUTHERLAND, sutherlandViscosity } from "./units.js";

describe("sutherlandViscosity", () => {
  it("matches SUTHERLAND.etaRef at T=288.15K to well within 1% (P1.28 validation criterion)", () => {
    const eta = sutherlandViscosity(288.15);
    expect(Math.abs(eta - SUTHERLAND.etaRef) / SUTHERLAND.etaRef).toBeLessThan(0.01);
    expect(eta).toBeCloseTo(SUTHERLAND.etaRef, 15); // exact by construction at T=Tref
  });

  it("matches the classic Sutherland reference point (1.716e-5 Pa*s at 273.15K) to within 1%", () => {
    const eta = sutherlandViscosity(273.15);
    const classicRef = 1.716e-5;
    expect(Math.abs(eta - classicRef) / classicRef).toBeLessThan(0.01);
  });

  it("increases monotonically with temperature over a physically relevant range", () => {
    const temps = [200, 250, 288.15, 300, 350, 400];
    let previous = -Infinity;
    for (const T of temps) {
      const eta = sutherlandViscosity(T);
      expect(eta).toBeGreaterThan(previous);
      previous = eta;
    }
  });
});
