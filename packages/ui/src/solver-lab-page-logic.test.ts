import { describe, expect, it } from "vitest";
import { formatCount, formatErrorReadout } from "./solver-lab-page-logic.js";

describe("formatErrorReadout", () => {
  it("renders 0 as a bare zero, not 0.00e+0", () => {
    expect(formatErrorReadout(0)).toBe("0");
  });

  it("renders a typical error in exponential notation", () => {
    expect(formatErrorReadout(0.0001661658650286425)).toBe("1.66e-4");
  });

  it("distinguishes errors that differ by orders of magnitude, unlike fixed-precision decimal", () => {
    const euler = formatErrorReadout(2.6e-7);
    const dopri5 = formatErrorReadout(2.1e-10);
    expect(euler).not.toBe(dopri5);
    expect(euler).toBe("2.60e-7");
    expect(dopri5).toBe("2.10e-10");
  });

  it("renders non-finite values as NaN/∞ rather than propagating garbage into the DOM", () => {
    expect(formatErrorReadout(NaN)).toBe("NaN");
    expect(formatErrorReadout(Infinity)).toBe("∞");
  });
});

describe("formatCount", () => {
  it("adds thousands separators", () => {
    expect(formatCount(3000)).toBe("3,000");
    expect(formatCount(40)).toBe("40");
  });
});
