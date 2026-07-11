import { describe, expect, it } from "vitest";
import { SUTHERLAND, sutherlandViscosity } from "./units.js";

describe("sutherlandViscosity", () => {
  it("returns etaRef at T=Tref to within 1%", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(eta).toBeCloseTo(1.789e-5, 0);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("exactly reduces to etaRef when T=Tref (formula degenerates to etaRef*1*1)", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("increases with temperature (viscosity of gases rises with T, unlike liquids)", () => {
    const etaCold = sutherlandViscosity(250);
    const etaHot = sutherlandViscosity(350);
    expect(etaHot).toBeGreaterThan(etaCold);
  });

  it("matches a hand-computed value at T=350K", () => {
    const T = 350;
    const expected =
      SUTHERLAND.etaRef *
      (T / SUTHERLAND.Tref) ** 1.5 *
      ((SUTHERLAND.Tref + SUTHERLAND.S) / (T + SUTHERLAND.S));
    expect(sutherlandViscosity(T)).toBeCloseTo(expected, 15);
  });
});
