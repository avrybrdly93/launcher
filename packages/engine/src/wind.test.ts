import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import {
  GaussianVortexWind,
  GriddedWindField,
  LogProfileWind,
  SinusoidalGustWind,
  UniformWind,
  type WindGrid,
} from "./wind.js";

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

describe("SinusoidalGustWind", () => {
  it("matches mean + amplitude*sin(omega*t + phase) at sampled t", () => {
    const mean = 4;
    const amplitude = 1.5;
    const omega = 2.3;
    const phase = 0.7;
    const wind = new SinusoidalGustWind(mean, amplitude, omega, phase);
    const out = new EnvSample();

    for (const t of [0, 0.1, 1, 3.7, -2.2, 100]) {
      wind.sample(t, 0, 0, out);
      const expected = mean + amplitude * Math.sin(omega * t + phase);
      expect(out.wx).toBeCloseTo(expected, 14);
      expect(out.wy).toBe(0);
    }
  });

  it("defaults phase to 0", () => {
    const wind = new SinusoidalGustWind(0, 1, 1);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBeCloseTo(0, 14);
  });
});

/** Composite trapezoid rule for the closed line integral oint w.dl over a circle of radius r. */
function circulationOnRing(
  wind: GaussianVortexWind,
  centerX: number,
  centerY: number,
  r: number,
  n = 2000,
): number {
  const out = new EnvSample();
  let circulation = 0;
  let prevTangential = 0;

  for (let i = 0; i <= n; i++) {
    const theta = (2 * Math.PI * i) / n;
    // Unit tangent for a counterclockwise parametrization: (-sin, cos).
    const tx = -Math.sin(theta);
    const ty = Math.cos(theta);
    wind.sample(0, centerX + r * Math.cos(theta), centerY + r * Math.sin(theta), out);
    const tangential = out.wx * tx + out.wy * ty;
    if (i > 0) circulation += 0.5 * (tangential + prevTangential) * ((2 * Math.PI * r) / n);
    prevTangential = tangential;
  }
  return circulation;
}

describe("GaussianVortexWind", () => {
  it("circulation integral on a ring far outside the core matches Gamma to 1%", () => {
    const gamma = 12.5;
    const coreRadius = 0.5;
    const wind = new GaussianVortexWind(3, -2, gamma, coreRadius);

    const circulation = circulationOnRing(wind, 3, -2, 6 * coreRadius);
    expect(Math.abs(circulation - gamma) / Math.abs(gamma)).toBeLessThan(0.01);
  });

  it("is finite (no NaN) exactly at the vortex center", () => {
    const wind = new GaussianVortexWind(0, 0, 10, 1);
    const out = new EnvSample();
    wind.sample(0, 0, 0, out);
    expect(out.wx).toBe(0);
    expect(out.wy).toBe(0);
  });

  it("wind is purely tangential (w . r_hat = 0 away from center)", () => {
    const wind = new GaussianVortexWind(0, 0, 10, 1);
    const out = new EnvSample();
    for (const [x, y] of [
      [2, 0],
      [0, 3],
      [1, 1],
      [-2, 1.5],
    ] as const) {
      wind.sample(0, x, y, out);
      const radialDot = out.wx * x + out.wy * y;
      expect(Math.abs(radialDot)).toBeLessThan(1e-12);
    }
  });
});

describe("GriddedWindField", () => {
  // wx(x,y) = 2 + 3x - y; wy(x,y) = -1 + x + 4y -- both affine, so a bilinear
  // interpolant reproduces them exactly everywhere inside the domain.
  const xs = [0, 1, 3, 4];
  const ys = [-2, 0, 2];
  const linearWx = (x: number, y: number) => 2 + 3 * x - y;
  const linearWy = (x: number, y: number) => -1 + x + 4 * y;
  const grid: WindGrid = {
    xs,
    ys,
    wx: ys.flatMap((y) => xs.map((x) => linearWx(x, y))),
    wy: ys.flatMap((y) => xs.map((x) => linearWy(x, y))),
  };

  it("reproduces a linear field exactly at grid points and in between", () => {
    const wind = new GriddedWindField(grid);
    const out = new EnvSample();

    for (const [x, y] of [
      [0, -2],
      [4, 2],
      [1, 0],
      [2.3, 1.1],
      [0.5, -1.5],
      [3.9, 1.9],
    ] as const) {
      wind.sample(0, x, y, out);
      expect(out.wx).toBeCloseTo(linearWx(x, y), 12);
      expect(out.wy).toBeCloseTo(linearWy(x, y), 12);
    }
  });

  it("clamps out-of-domain queries to the nearest edge value", () => {
    const wind = new GriddedWindField(grid);
    const out = new EnvSample();
    const atCorner = new EnvSample();

    wind.sample(0, xs[0]!, ys[0]!, atCorner);
    wind.sample(0, -100, -100, out);
    expect(out.wx).toBe(atCorner.wx);
    expect(out.wy).toBe(atCorner.wy);

    wind.sample(0, xs[xs.length - 1]!, ys[ys.length - 1]!, atCorner);
    wind.sample(0, 1000, 1000, out);
    expect(out.wx).toBe(atCorner.wx);
    expect(out.wy).toBe(atCorner.wy);

    // Clamped in x only, interpolated normally in y.
    wind.sample(0, -50, 1, out);
    wind.sample(0, xs[0]!, 1, atCorner);
    expect(out.wx).toBe(atCorner.wx);
    expect(out.wy).toBe(atCorner.wy);
  });
});
