import { describe, expect, it } from "vitest";
import {
  eigenvalues2x2,
  sampleStabilityRegionGrid,
  stabilityFunction,
  stabilityFunctionMagnitude,
} from "./stability-region.js";

describe("stabilityFunction (eq. 4.11)", () => {
  it("R_Euler(z) = 1 + z exactly", () => {
    for (const z of [
      { re: 0, im: 0 },
      { re: -1, im: 0.5 },
      { re: 2, im: -3 },
    ]) {
      expect(stabilityFunction(1, z)).toEqual({ re: 1 + z.re, im: z.im });
    }
  });

  it("R_RK2(z) = 1 + z + z^2/2", () => {
    const z = { re: 0.3, im: -0.7 };
    const zSq = { re: z.re * z.re - z.im * z.im, im: 2 * z.re * z.im };
    const expected = { re: 1 + z.re + zSq.re / 2, im: z.im + zSq.im / 2 };
    const actual = stabilityFunction(2, z);
    expect(actual.re).toBeCloseTo(expected.re, 12);
    expect(actual.im).toBeCloseTo(expected.im, 12);
  });

  it("R_RK4(z) matches the direct sum_{j=0}^{4} z^j/j! at several points", () => {
    for (const z of [
      { re: -1.2, im: 0.4 },
      { re: 0.5, im: 1.5 },
      { re: -2, im: -1 },
    ]) {
      let sumRe = 0;
      let sumIm = 0;
      let termRe = 1;
      let termIm = 0;
      for (let j = 0; j <= 4; j++) {
        if (j > 0) {
          const newRe = (termRe * z.re - termIm * z.im) / j;
          const newIm = (termRe * z.im + termIm * z.re) / j;
          termRe = newRe;
          termIm = newIm;
        }
        sumRe += termRe;
        sumIm += termIm;
      }
      const actual = stabilityFunction(4, z);
      expect(actual.re).toBeCloseTo(sumRe, 10);
      expect(actual.im).toBeCloseTo(sumIm, 10);
    }
  });
});

describe("Euler's stability region is the disk |1+z| <= 1 (eq. 4.11)", () => {
  it("|R(z)| == 1 exactly on the disk boundary z = -1 + e^{i theta}", () => {
    for (let k = 0; k < 16; k++) {
      const theta = (2 * Math.PI * k) / 16;
      const z = { re: -1 + Math.cos(theta), im: Math.sin(theta) };
      expect(stabilityFunctionMagnitude(1, z)).toBeCloseTo(1, 12);
    }
  });

  it("|R(z)| < 1 strictly inside the disk and > 1 strictly outside", () => {
    expect(stabilityFunctionMagnitude(1, { re: -1, im: 0 })).toBeLessThan(1);
    expect(stabilityFunctionMagnitude(1, { re: -0.5, im: 0 })).toBeLessThan(1);
    expect(stabilityFunctionMagnitude(1, { re: 1, im: 0 })).toBeGreaterThan(1);
    expect(stabilityFunctionMagnitude(1, { re: -1, im: 2 })).toBeGreaterThan(1);
  });
});

describe("RK4's stability region extends beyond Euler's/RK2's (eq. 4.11)", () => {
  it("real-axis crossing is approximately -2.785, well past Euler's -2", () => {
    let lo = -3;
    let hi = -2.5;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (stabilityFunctionMagnitude(4, { re: mid, im: 0 }) > 1) lo = mid;
      else hi = mid;
    }
    expect((lo + hi) / 2).toBeCloseTo(-2.785293563405282, 6);
  });

  it("includes a genuine imaginary-axis interval |z| < 2*sqrt(2), unlike Euler/RK2", () => {
    const zInside = { re: 0, im: 2 };
    const zOutside = { re: 0, im: 3 };
    expect(stabilityFunctionMagnitude(4, zInside)).toBeLessThanOrEqual(1);
    expect(stabilityFunctionMagnitude(4, zOutside)).toBeGreaterThan(1);

    // Euler and RK2 are unstable anywhere on the imaginary axis except z=0
    // (blueprint §4.6: "unlike Euler/RK2, [RK4] includes a genuine interval
    // of the imaginary axis").
    expect(stabilityFunctionMagnitude(1, zInside)).toBeGreaterThan(1);
    expect(stabilityFunctionMagnitude(2, zInside)).toBeGreaterThan(1);
  });

  it("imaginary-axis crossing matches 2*sqrt(2) to 1e-6", () => {
    let lo = 2.5;
    let hi = 3.5;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (stabilityFunctionMagnitude(4, { re: 0, im: mid }) < 1) lo = mid;
      else hi = mid;
    }
    expect((lo + hi) / 2).toBeCloseTo(2 * Math.sqrt(2), 6);
  });
});

describe("sampleStabilityRegionGrid", () => {
  it("produces an imAxis.length x reAxis.length magnitude grid matching pointwise evaluation", () => {
    const grid = sampleStabilityRegionGrid(4, [-3, 1], [-2, 2], 9, 5);
    expect(grid.reAxis).toHaveLength(9);
    expect(grid.imAxis).toHaveLength(5);
    expect(grid.magnitude).toHaveLength(5);
    expect(grid.magnitude[0]).toHaveLength(9);

    for (let row = 0; row < grid.imAxis.length; row++) {
      for (let col = 0; col < grid.reAxis.length; col++) {
        const expected = stabilityFunctionMagnitude(4, {
          re: grid.reAxis[col]!,
          im: grid.imAxis[row]!,
        });
        expect(grid.magnitude[row]![col]).toBeCloseTo(expected, 12);
      }
    }
  });

  it("includes both range endpoints exactly", () => {
    const grid = sampleStabilityRegionGrid(1, [-2, 0.5], [-1, 1], 6, 4);
    expect(grid.reAxis[0]).toBeCloseTo(-2, 12);
    expect(grid.reAxis.at(-1)).toBeCloseTo(0.5, 12);
    expect(grid.imAxis[0]).toBeCloseTo(-1, 12);
    expect(grid.imAxis.at(-1)).toBeCloseTo(1, 12);
  });

  it("rejects a grid smaller than 2x2", () => {
    expect(() => sampleStabilityRegionGrid(1, [-1, 1], [-1, 1], 1, 5)).toThrow();
    expect(() => sampleStabilityRegionGrid(1, [-1, 1], [-1, 1], 5, 1)).toThrow();
  });
});

describe("eigenvalues2x2", () => {
  it("returns the two real roots for a symmetric matrix", () => {
    // [[3, 1], [1, 3]] has eigenvalues 4 and 2.
    const [l1, l2] = eigenvalues2x2(3, 1, 1, 3);
    expect(l1.im).toBe(0);
    expect(l2.im).toBe(0);
    expect([l1.re, l2.re].sort((a, b) => b - a)).toEqual([4, 2]);
  });

  it("returns a conjugate pair for a pure-rotation-generator matrix", () => {
    // [[0, 1], [-1, 0]] has eigenvalues +-i.
    const [l1, l2] = eigenvalues2x2(0, 1, -1, 0);
    expect(l1.re).toBeCloseTo(0, 12);
    expect(l2.re).toBeCloseTo(0, 12);
    expect([l1.im, l2.im].sort((a, b) => a - b)).toEqual([-1, 1]);
  });

  it("matches the diagonal entries for a diagonal matrix", () => {
    const [l1, l2] = eigenvalues2x2(-5, 0, 0, -7);
    expect([l1.re, l2.re].sort((a, b) => b - a)).toEqual([-5, -7]);
    expect(l1.im).toBe(0);
    expect(l2.im).toBe(0);
  });
});
