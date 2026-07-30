import { describe, expect, it } from "vitest";
import { PchipInterpolator } from "./pchip.js";
import {
  FlatTerrain,
  FunctionTerrain,
  PiecewisePchipTerrain,
  groundHeightResidual,
} from "./terrain.js";

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

describe("PiecewisePchipTerrain (P4.13 terrain editor data model)", () => {
  it("evaluates the same as a raw PchipInterpolator through the same control points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 1.5 },
      { x: 10, y: 0.5 },
      { x: 20, y: 3 },
    ];
    const terrain = new PiecewisePchipTerrain(points);
    const reference = new PchipInterpolator(
      points.map((p) => p.x),
      points.map((p) => p.y),
    );
    for (const x of [-1, 0, 2.5, 5, 7.5, 10, 15, 20, 25]) {
      expect(terrain.height(x)).toBe(reference.evaluate(x));
    }
  });

  it("exposes the control points it was built from", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
    ];
    const terrain = new PiecewisePchipTerrain(points);
    expect(terrain.controlPoints).toEqual(points);
  });

  it("rejects fewer than 2 control points", () => {
    expect(() => new PiecewisePchipTerrain([{ x: 0, y: 0 }])).toThrow();
    expect(() => new PiecewisePchipTerrain([])).toThrow();
  });

  it("passes through every control point exactly, including a sloped run", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 20, y: 1 },
    ];
    const terrain = new PiecewisePchipTerrain(points);
    for (const p of points) {
      expect(terrain.height(p.x)).toBeCloseTo(p.y, 12);
    }
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
