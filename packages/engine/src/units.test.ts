import { describe, expect, it } from "vitest";
import { SUTHERLAND, sutherlandViscosity } from "./units.js";

describe("sutherlandViscosity", () => {
  it("eta(288.15 K) = 1.789e-5 +/- 1% (eq. 3.12 reference point)", () => {
    const eta = sutherlandViscosity(288.15);
    expect(eta).toBeGreaterThan(1.789e-5 * 0.99);
    expect(eta).toBeLessThan(1.789e-5 * 1.01);
  });

  it("eta(Tref) equals etaRef exactly", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("is monotonically increasing with temperature (air gets more viscous when hotter)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaRef = sutherlandViscosity(288.15);
    const etaHot = sutherlandViscosity(350);
    expect(etaCold).toBeLessThan(etaRef);
    expect(etaRef).toBeLessThan(etaHot);
  });
});
