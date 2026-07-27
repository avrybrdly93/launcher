import { describe, expect, it } from "vitest";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";

describe("SaturatingLiftCoefficient", () => {
  const model = new SaturatingLiftCoefficient();

  it("grows linearly for small spin ratios", () => {
    expect(model.cl(0.1)).toBeCloseTo(0.16, 10);
  });

  it("saturates at 0.6 for large spin ratios", () => {
    expect(model.cl(10)).toBe(0.6);
    expect(model.cl(Infinity)).toBe(0.6);
  });

  it("is symmetric in the sign of S", () => {
    expect(model.cl(-0.2)).toBe(model.cl(0.2));
  });

  it("is monotone non-decreasing in |S| (P4.06 validation criterion)", () => {
    const spinRatios = [0, 0.05, 0.1, 0.2, 0.3, 0.375, 0.5, 1, 2, 5, 10];
    let prev = -Infinity;
    for (const s of spinRatios) {
      const cl = model.cl(s);
      expect(cl).toBeGreaterThanOrEqual(prev);
      prev = cl;
    }
  });

  it("never exceeds maxCl (P4.06 validation criterion: <=0.6 for the default fit)", () => {
    for (const s of [0, 0.1, 0.375, 0.6, 1, 100, Infinity]) {
      expect(model.cl(s)).toBeLessThanOrEqual(0.6);
    }
  });

  it("honors a custom (sport-specific) maxCl/slope, still monotone and capped", () => {
    const soccer = new SaturatingLiftCoefficient(0.33, 1.0);
    expect(soccer.cl(0)).toBe(0);
    expect(soccer.cl(0.2)).toBeCloseTo(0.2, 10);
    expect(soccer.cl(1)).toBe(0.33);
    expect(soccer.cl(10)).toBeLessThanOrEqual(0.33);
  });
});
