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
});
