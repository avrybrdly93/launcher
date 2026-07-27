import { describe, expect, it } from "vitest";
import { FlatTerrain, FunctionTerrain, PchipTerrain, groundHeightResidual } from "./terrain.js";

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

describe("PchipTerrain (P4.13 editor data model)", () => {
  it("interpolates exactly through each control point", () => {
    const terrain = new PchipTerrain([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 2 },
      { x: 30, y: 2 },
    ]);
    expect(terrain.height(0)).toBeCloseTo(0, 12);
    expect(terrain.height(10)).toBeCloseTo(5, 12);
    expect(terrain.height(20)).toBeCloseTo(2, 12);
    expect(terrain.height(30)).toBeCloseTo(2, 12);
  });

  it("accepts control points in any order (an editor drags points independently, so x-order can change)", () => {
    const points = [
      { x: 20, y: 2 },
      { x: 0, y: 0 },
      { x: 30, y: 2 },
      { x: 10, y: 5 },
    ];
    const shuffled = new PchipTerrain(points);
    const sorted = new PchipTerrain([...points].sort((a, b) => a.x - b.x));

    for (const x of [-5, 0, 3, 10, 15, 20, 25, 30, 35]) {
      expect(shuffled.height(x)).toBe(sorted.height(x));
    }
    expect(shuffled.controlPoints.map((p) => p.x)).toEqual([0, 10, 20, 30]);
  });

  it("never overshoots a monotone slope between its control points", () => {
    const terrain = new PchipTerrain([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
    for (let x = 0; x <= 20; x += 0.5) {
      expect(terrain.height(x)).toBeGreaterThanOrEqual(-1e-9);
      expect(terrain.height(x)).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it("clamps to the nearest endpoint outside the control-point domain (flat ground past the edited region)", () => {
    const terrain = new PchipTerrain([
      { x: 0, y: 3 },
      { x: 10, y: 7 },
    ]);
    expect(terrain.height(-100)).toBe(3);
    expect(terrain.height(1000)).toBe(7);
  });

  it("rejects fewer than 2 control points", () => {
    expect(() => new PchipTerrain([{ x: 0, y: 0 }])).toThrow();
  });

  it("rejects duplicate x values, even after sorting", () => {
    expect(
      () =>
        new PchipTerrain([
          { x: 5, y: 1 },
          { x: 5, y: 2 },
        ]),
    ).toThrow();
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
