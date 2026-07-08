import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import { LogProfileWind, UniformWind } from "./wind.js";

describe("UniformWind", () => {
  it("is constant everywhere: position, height, and time do not matter", () => {
    const wind = new UniformWind(5, -2);
    const out = new EnvSample();
    for (const [t, x, y] of [
      [0, 0, 0],
      [10, 100, 50],
      [-5, -1000, 2000],
      [3.14, 0.001, -0.001],
    ] as const) {
      wind.sample(t, x, y, out);
      expect(out.wx).toBe(5);
      expect(out.wy).toBe(-2);
    }
  });

  it("defaults wy to 0", () => {
    const wind = new UniformWind(3);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(3);
    expect(out.wy).toBe(0);
  });
});

describe("LogProfileWind", () => {
  it("w(y_r*(e-1))*kappa/u* = 1", () => {
    const uStar = 2;
    const yr = 0.01;
    const kappa = 0.41;
    const wind = new LogProfileWind(uStar, yr, kappa);
    const out = new EnvSample();
    wind.sample(0, 0, yr * (Math.E - 1), out);
    expect((out.wx * kappa) / uStar).toBeCloseTo(1, 12);
  });

  it("w is finite (no NaN/Inf) at y=0 and below", () => {
    const wind = new LogProfileWind(2, 0.01);
    const out = new EnvSample();
    for (const y of [0, -1, -100, -1e6]) {
      wind.sample(0, 0, y, out);
      expect(Number.isFinite(out.wx)).toBe(true);
      expect(out.wx).toBe(0); // clamped to ground level: ln(y_r/y_r) = 0
    }
  });

  it("wind speed increases monotonically with height", () => {
    const wind = new LogProfileWind(2, 0.01);
    const out = new EnvSample();
    let previous = -Infinity;
    for (const y of [0, 1, 5, 10, 50]) {
      wind.sample(0, 0, y, out);
      expect(out.wx).toBeGreaterThan(previous);
      previous = out.wx;
    }
  });
});
