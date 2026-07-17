import { describe, expect, it } from "vitest";
import { FlatTerrain, FunctionTerrain, groundHeightResidual } from "./terrain.js";

describe("FlatTerrain", () => {
  it("is h(x) = 0 everywhere", () => {
    const terrain = new FlatTerrain();
    for (const x of [-1000, -1, 0, 0.5, 42, 1e6]) {
      expect(terrain.height(x)).toBe(0);
    }
  });
});

describe("FunctionTerrain", () => {
  it("evaluates the wrapped height function", () => {
    const terrain = new FunctionTerrain((x) => 0.2 * x);
    expect(terrain.height(0)).toBe(0);
    expect(terrain.height(10)).toBeCloseTo(2, 12);
    expect(terrain.height(-5)).toBeCloseTo(-1, 12);
  });
});

describe("groundHeightResidual", () => {
  it("g = y - h(x) evaluates against flat terrain", () => {
    const terrain = new FlatTerrain();
    expect(groundHeightResidual(terrain, 5, 1.5)).toBe(1.5);
    expect(groundHeightResidual(terrain, 5, 0)).toBe(0);
    expect(groundHeightResidual(terrain, 5, -0.01)).toBeCloseTo(-0.01, 12);
  });

  it("g = y - h(x) evaluates against a sloped terrain", () => {
    const terrain = new FunctionTerrain((x) => 0.2 * x);
    expect(groundHeightResidual(terrain, 10, 3)).toBeCloseTo(1, 12); // h(10) = 2
    expect(groundHeightResidual(terrain, 10, 2)).toBeCloseTo(0, 12); // exactly on the slope
  });
});
