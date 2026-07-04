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
});
