import { describe, expect, it } from "vitest";
import type { EigenvalueSample } from "@ballista/runtime";
import {
  DEFAULT_STABILITY_H,
  defaultStabilityRegionRange,
  formatComplex,
  formatH,
  parseH,
  scaleEigenvaluesByH,
} from "./stability-explorer-page-logic.js";

describe("formatH / parseH", () => {
  it("round-trips a positive step size", () => {
    expect(parseH(formatH(DEFAULT_STABILITY_H))).toBe(DEFAULT_STABILITY_H);
  });

  it("rejects non-numeric, zero, and negative input", () => {
    expect(parseH("abc")).toBeUndefined();
    expect(parseH("0")).toBeUndefined();
    expect(parseH("-0.01")).toBeUndefined();
    expect(parseH("")).toBeUndefined();
  });

  it("accepts a small positive decimal", () => {
    expect(parseH("0.005")).toBe(0.005);
  });
});

describe("scaleEigenvaluesByH", () => {
  it("scales both velocity-block branches of every sample by h", () => {
    const samples: readonly EigenvalueSample[] = [
      {
        t: 0,
        speed: 10,
        lambda: [
          { re: -2, im: 1 },
          { re: -2, im: -1 },
        ],
      },
      {
        t: 1,
        speed: 5,
        lambda: [
          { re: -1, im: 0 },
          { re: -0.5, im: 0 },
        ],
      },
    ];

    const points = scaleEigenvaluesByH(samples, 0.1);

    expect(points).toEqual([
      { re: -0.2, im: 0.1 },
      { re: -0.2, im: -0.1 },
      { re: -0.1, im: 0 },
      { re: -0.05, im: 0 },
    ]);
  });

  it("returns an empty array for no samples", () => {
    expect(scaleEigenvaluesByH([], 0.1)).toEqual([]);
  });
});

describe("defaultStabilityRegionRange", () => {
  it("gives RK4 (order 4) a wider window than Euler (order 1), fitting eq. 4.11's larger region", () => {
    const euler = defaultStabilityRegionRange(1);
    const rk4 = defaultStabilityRegionRange(4);
    expect(rk4.reRange[0]).toBeLessThan(euler.reRange[0]);
    expect(rk4.imRange[1]).toBeGreaterThan(euler.imRange[1]);
  });

  it("every window's real range spans zero (methods are unstable for Re(z) > 0)", () => {
    for (const order of [1, 2, 4]) {
      const { reRange } = defaultStabilityRegionRange(order);
      expect(reRange[0]).toBeLessThan(0);
      expect(reRange[1]).toBeGreaterThan(0);
    }
  });
});

describe("formatComplex", () => {
  it("formats a positive imaginary part with a + sign", () => {
    expect(formatComplex({ re: -0.321, im: 0.15 })).toBe("-0.321 + 0.150i");
  });

  it("formats a negative imaginary part with a - sign and positive magnitude", () => {
    expect(formatComplex({ re: -0.321, im: -0.15 })).toBe("-0.321 - 0.150i");
  });

  it("formats a purely real number with a +0.000i suffix", () => {
    expect(formatComplex({ re: -1, im: 0 })).toBe("-1.000 + 0.000i");
  });
});
