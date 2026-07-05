import { describe, expect, it } from "vitest";
import { PchipInterpolator } from "./pchip.js";

describe("PchipInterpolator", () => {
  it("passes through every knot exactly", () => {
    const x = [0, 1, 2, 3, 4];
    const y = [0, 1, 4, 9, 16];
    const p = new PchipInterpolator(x, y);
    for (let i = 0; i < x.length; i++) {
      expect(p.evaluate(x[i]!)).toBeCloseTo(y[i]!, 12);
    }
  });

  it("does not overshoot on monotone data", () => {
    const x = [0, 1, 2, 3];
    const y = [0, 1, 1, 5]; // sharp flattening then rise: classic overshoot trap
    const p = new PchipInterpolator(x, y);
    const ys = Array.from({ length: 200 }, (_, i) => p.evaluate((i / 199) * 3));
    const minY = Math.min(...y);
    const maxY = Math.max(...y);
    for (const v of ys) {
      expect(v).toBeGreaterThanOrEqual(minY - 1e-9);
      expect(v).toBeLessThanOrEqual(maxY + 1e-9);
    }
  });

  it("clamps queries outside the domain to the nearest endpoint value", () => {
    const p = new PchipInterpolator([0, 1, 2], [10, 20, 30]);
    expect(p.evaluate(-5)).toBe(10);
    expect(p.evaluate(100)).toBe(30);
  });

  it("rejects non-increasing x", () => {
    expect(() => new PchipInterpolator([0, 1, 1], [0, 1, 2])).toThrow();
  });

  // Fixture generated with SciPy: scipy.interpolate.PchipInterpolator on
  // irregularly-spaced, non-monotone data (P1.11 validation criterion).
  //   from scipy.interpolate import PchipInterpolator
  //   x = [0.5, 1.7, 2.1, 3.4, 5.0, 6.2, 9.0]
  //   y = [1.2, 0.8, 0.9, 2.6, 2.55, 4.1, 4.05]
  //   p = PchipInterpolator(x, y); [p(q) for q in qs]
  it("matches SciPy PchipInterpolator on a fixture to 1e-10", () => {
    const x = [0.5, 1.7, 2.1, 3.4, 5.0, 6.2, 9.0];
    const y = [1.2, 0.8, 0.9, 2.6, 2.55, 4.1, 4.05];
    const p = new PchipInterpolator(x, y);
    const cases: [number, number][] = [
      [0.6, 1.1273582175925927],
      [0.9, 0.9592592592592593],
      [1.2, 0.856785300925926],
      [1.6999, 0.8000000019097947],
      [1.9, 0.8312581063553827],
      [2.1, 0.9],
      [2.5, 1.3556584943387604],
      [3.0, 2.2481427627698896],
      [3.3999, 2.599999972707179],
      [4.0, 2.5841796875000003],
      [4.6, 2.5578125],
      [5.0, 2.55],
      [5.5, 3.1330439814814808],
      [6.2, 4.1],
      [7.0, 4.098833819241982],
      [8.0, 4.086716472303206],
      [8.9999, 4.050005356951533],
    ];
    for (const [q, expected] of cases) {
      expect(p.evaluate(q)).toBeCloseTo(expected, 10);
    }
  });
});
