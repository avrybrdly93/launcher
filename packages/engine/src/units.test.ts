import { describe, expect, it } from "vitest";
import { SUTHERLAND, sutherlandViscosity } from "./units.js";

describe("sutherlandViscosity", () => {
  it("eta(288.15K) = 1.789e-5 +/- 1% (the reference point, exact by construction)", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(eta).toBeCloseTo(1.789e-5, 8);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("increases with temperature (denser molecular momentum transfer, not less-dense-gas intuition)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaHot = sutherlandViscosity(320);
    expect(etaHot).toBeGreaterThan(etaCold);
  });

  it("matches the closed-form eq. 3.12 at an off-reference point to 1e-15", () => {
    const T = 300;
    const expected =
      SUTHERLAND.etaRef *
      Math.pow(T / SUTHERLAND.Tref, 1.5) *
      ((SUTHERLAND.Tref + SUTHERLAND.S) / (T + SUTHERLAND.S));
    expect(sutherlandViscosity(T)).toBeCloseTo(expected, 15);
  });
});
