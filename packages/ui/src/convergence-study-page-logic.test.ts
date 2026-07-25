import { describe, expect, it } from "vitest";
import {
  DEFAULT_H_LADDER,
  formatHLadder,
  formatSlope,
  parseHLadder,
} from "./convergence-study-page-logic.js";

describe("formatHLadder / parseHLadder", () => {
  it("round-trips DEFAULT_H_LADDER through format then parse", () => {
    expect(parseHLadder(formatHLadder(DEFAULT_H_LADDER))).toEqual(DEFAULT_H_LADDER);
  });

  it("parses comma-and-space-separated numbers", () => {
    expect(parseHLadder("0.1, 0.05,0.025 0.0125")).toEqual([0.1, 0.05, 0.025, 0.0125]);
  });

  it("drops non-numeric and non-positive tokens rather than rejecting the whole field", () => {
    expect(parseHLadder("0.1, abc, -0.05, 0, 0.025,")).toEqual([0.1, 0.025]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseHLadder("")).toEqual([]);
    expect(parseHLadder("   ")).toEqual([]);
  });

  it("preserves the given order rather than sorting", () => {
    expect(parseHLadder("0.01, 0.1, 0.05")).toEqual([0.01, 0.1, 0.05]);
  });
});

describe("formatSlope", () => {
  it("fixes to 2 decimal places", () => {
    expect(formatSlope(0.9986994052338334)).toBe("1.00");
    expect(formatSlope(3.572560765703433)).toBe("3.57");
  });

  it("renders non-finite values distinctly rather than propagating garbage", () => {
    expect(formatSlope(NaN)).toBe("NaN");
    expect(formatSlope(Infinity)).toBe("∞");
  });
});
