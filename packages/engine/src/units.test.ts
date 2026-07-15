import { describe, expect, it } from "vitest";
import { sutherlandViscosity, SUTHERLAND } from "./units.js";

describe("sutherlandViscosity (eq. 3.12)", () => {
  it("eta(288.15K) = 1.789e-5 +/- 1% (P1.28 validation criterion)", () => {
    const eta = sutherlandViscosity(SUTHERLAND.Tref);
    expect(eta).toBeGreaterThan(1.789e-5 * 0.99);
    expect(eta).toBeLessThan(1.789e-5 * 1.01);
  });

  it("increases with temperature (viscosity of a gas rises with T)", () => {
    expect(sutherlandViscosity(400)).toBeGreaterThan(sutherlandViscosity(288.15));
  });
});
