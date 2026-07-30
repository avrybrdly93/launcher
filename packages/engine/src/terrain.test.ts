import { describe, expect, it } from "vitest";
import { PchipInterpolator } from "./pchip.js";
import {
  FlatTerrain,
  FunctionTerrain,
  PiecewisePchipTerrain,
  deserializeTerrainControlPoints,
  groundHeightResidual,
  sanitizeTerrainControlPoints,
  serializeTerrainControlPoints,
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

describe("sanitizeTerrainControlPoints (P4.14 editor UI drag bookkeeping)", () => {
  it("sorts out-of-order points by x", () => {
    const result = sanitizeTerrainControlPoints([
      { x: 10, y: 2 },
      { x: 0, y: 0 },
      { x: 5, y: 1 },
    ]);
    expect(result.map((p) => p.x)).toEqual([0, 5, 10]);
  });

  it("merges points with equal x, keeping the last one in original order", () => {
    const result = sanitizeTerrainControlPoints([
      { x: 0, y: 0 },
      { x: 5, y: 1 },
      { x: 5, y: 99 },
      { x: 10, y: 2 },
    ]);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 99 },
      { x: 10, y: 2 },
    ]);
  });

  it("does not mutate the input array", () => {
    const points = [
      { x: 10, y: 2 },
      { x: 0, y: 0 },
    ];
    const original = [...points];
    sanitizeTerrainControlPoints(points);
    expect(points).toEqual(original);
  });

  it("the sanitized result always satisfies PiecewisePchipTerrain's strictly-increasing-x contract", () => {
    const result = sanitizeTerrainControlPoints([
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 0, y: 0 },
    ]);
    expect(() => new PiecewisePchipTerrain(result)).not.toThrow();
  });
});

describe("serializeTerrainControlPoints / deserializeTerrainControlPoints (P4.14 round trip)", () => {
  it("round-trips control points exactly", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 1.5 },
      { x: 20, y: -3.25 },
    ];
    const json = serializeTerrainControlPoints(points);
    const roundTripped = deserializeTerrainControlPoints(json);
    expect(roundTripped).toEqual(points);
  });

  it("produces plain JSON text, not some non-portable serialization", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 1.5 },
    ];
    const json = serializeTerrainControlPoints(points);
    expect(typeof json).toBe("string");
    expect(JSON.parse(json)).toEqual(points);
  });

  it("a round-tripped terrain evaluates identically to the original", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 1.5 },
      { x: 10, y: 0.5 },
      { x: 20, y: 3 },
    ];
    const terrain = new PiecewisePchipTerrain(points);
    const roundTripped = new PiecewisePchipTerrain(
      deserializeTerrainControlPoints(serializeTerrainControlPoints(points)),
    );
    for (const x of [-1, 0, 2.5, 5, 7.5, 10, 15, 20, 25]) {
      expect(roundTripped.height(x)).toBe(terrain.height(x));
    }
  });

  it("throws a SyntaxError on malformed JSON, rather than silently discarding it", () => {
    expect(() => deserializeTerrainControlPoints("not json")).toThrow(SyntaxError);
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
