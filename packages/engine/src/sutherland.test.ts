import { describe, expect, it } from "vitest";
import { sutherlandViscosity } from "./sutherland.js";
import { SUTHERLAND } from "./units.js";

describe("sutherlandViscosity", () => {
  it("eta(288.15 K) = 1.789e-5 +/- 1%", () => {
    const eta = sutherlandViscosity(288.15);
    expect(eta).toBeGreaterThan(1.789e-5 * 0.99);
    expect(eta).toBeLessThan(1.789e-5 * 1.01);
  });

  it("equals eta_ref exactly at T = Tref (both correction factors are 1)", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases with temperature (air gets more viscous when hotter)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaHot = sutherlandViscosity(320);
    expect(etaHot).toBeGreaterThan(etaCold);
  });

  it("stays positive and finite across a wide temperature range", () => {
    for (const T of [200, 250, 288.15, 300, 350, 400]) {
      const eta = sutherlandViscosity(T);
      expect(eta).toBeGreaterThan(0);
      expect(Number.isFinite(eta)).toBe(true);
    }
  });
});
