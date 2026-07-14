import { describe, expect, it } from "vitest";
import { sutherlandViscosity } from "./sutherland-viscosity.js";

describe("sutherlandViscosity (P1.28, eq. 3.12)", () => {
  it("eta(288.15K) = 1.789e-5 +/- 1%", () => {
    const eta = sutherlandViscosity(288.15);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("is monotonically increasing with temperature over the ISA range", () => {
    const temps = [200, 250, 288.15, 300, 350, 400];
    const values = temps.map(sutherlandViscosity);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  it("reduces to etaRef exactly at T = Tref", () => {
    expect(sutherlandViscosity(288.15)).toBeCloseTo(1.789e-5, 15);
  });
});
