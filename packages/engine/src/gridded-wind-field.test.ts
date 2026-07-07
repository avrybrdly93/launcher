import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import { GriddedWindField, type GriddedWindFieldData } from "./gridded-wind-field.js";

function makeLinearField(a: number, bCoef: number, cCoef: number): GriddedWindFieldData {
  const xs = [-10, -3, 0, 4, 10];
  const ys = [-5, 0, 2, 8];
  const linear = (x: number, y: number) => a + bCoef * x + cCoef * y;
  const wx = ys.map((y) => xs.map((x) => linear(x, y)));
  const wy = ys.map((y) => xs.map((x) => linear(x, y) * 0.5));
  return { xs, ys, wx, wy };
}

describe("GriddedWindField (P1.33)", () => {
  it("reproduces an affine field exactly at grid nodes and interior points", () => {
    const field = new GriddedWindField(makeLinearField(2, 0.7, -1.3));
    const out = new EnvSample();

    const samples: [number, number][] = [
      [-10, -5], // exactly a grid node
      [0, 2], // exactly a grid node
      [1.5, 3.2], // interior, off-grid
      [-7.1, 6.9], // interior, off-grid
      [3.999, -4.999], // near a node but not on it
    ];

    for (const [x, y] of samples) {
      field.sample(0, x, y, out);
      expect(out.wx).toBeCloseTo(2 + 0.7 * x - 1.3 * y, 12);
      expect(out.wy).toBeCloseTo((2 + 0.7 * x - 1.3 * y) * 0.5, 12);
    }
  });

  it("clamps out-of-domain queries to the nearest edge value instead of extrapolating", () => {
    const field = new GriddedWindField(makeLinearField(2, 0.7, -1.3));
    const out = new EnvSample();
    const edge = new EnvSample();

    // Far outside the domain on every side.
    field.sample(0, -1000, -5, out);
    field.sample(0, -10, -5, edge); // the actual x=-10 (leftmost) edge value
    expect(out.wx).toBeCloseTo(edge.wx, 12);
    expect(out.wy).toBeCloseTo(edge.wy, 12);

    field.sample(0, 1000, 8, out);
    field.sample(0, 10, 8, edge); // rightmost edge
    expect(out.wx).toBeCloseTo(edge.wx, 12);

    field.sample(0, 0, -1000, out);
    field.sample(0, 0, -5, edge); // bottom edge
    expect(out.wx).toBeCloseTo(edge.wx, 12);

    field.sample(0, 0, 1000, out);
    field.sample(0, 0, 8, edge); // top edge
    expect(out.wx).toBeCloseTo(edge.wx, 12);
  });

  it("clamps a corner query to the corner value, not a partial extrapolation", () => {
    const field = new GriddedWindField(makeLinearField(2, 0.7, -1.3));
    const out = new EnvSample();
    field.sample(0, 1000, 1000, out);
    expect(out.wx).toBeCloseTo(2 + 0.7 * 10 - 1.3 * 8, 12);
  });
});
