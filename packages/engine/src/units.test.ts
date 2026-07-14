import { describe, expect, it } from "vitest";
import { SUTHERLAND, sutherlandViscosity } from "./units.js";

describe("sutherlandViscosity", () => {
  it("eta(288.15 K) = 1.789e-5 to within 1%", () => {
    const eta = sutherlandViscosity(288.15);
    expect(Math.abs(eta - 1.789e-5) / 1.789e-5).toBeLessThan(0.01);
  });

  it("eta(Tref) equals etaRef exactly (ratio terms collapse to 1)", () => {
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  it("is monotonically increasing with temperature over a typical atmospheric range", () => {
    let previous = 0;
    for (const T of [200, 250, 288.15, 300, 350, 400]) {
      const eta = sutherlandViscosity(T);
      expect(eta).toBeGreaterThan(previous);
      previous = eta;
    }
  });

  it("matches published reference values within 1% (e.g. eta(300K) ~ 1.846e-5 Pa*s)", () => {
    const eta300 = sutherlandViscosity(300);
    expect(Math.abs(eta300 - 1.846e-5) / 1.846e-5).toBeLessThan(0.01);
  });
});
