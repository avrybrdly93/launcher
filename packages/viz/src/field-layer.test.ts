import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  EnvSample,
  Environment,
  GaussianVortexWind,
  UniformGravity,
  UniformWind,
  ZeroWind,
} from "@ballista/engine";
import { IDENTITY_CAMERA, screenToWorld, type Viewport } from "./camera2d.js";
import type { ForceGlyphCanvas } from "./force-glyphs.js";
import {
  computeFieldArrows,
  DEFAULT_FIELD_GRID,
  DEFAULT_FIELD_SCALE,
  drawFieldLayer,
  fieldArrowLengthPx,
  fieldGridScreenPoints,
  fieldLegendTicks,
  type FieldLayerGridConfig,
} from "./field-layer.js";

const VIEWPORT: Viewport = { width: 400, height: 400 };

describe("fieldGridScreenPoints", () => {
  it("returns cols*rows points, all within the margin-inset viewport bounds", () => {
    const grid: FieldLayerGridConfig = { cols: 24, rows: 16, marginPx: 24 };
    const points = fieldGridScreenPoints(VIEWPORT, grid);

    expect(points).toHaveLength(24 * 16);
    for (const { x, y } of points) {
      expect(x).toBeGreaterThanOrEqual(grid.marginPx);
      expect(x).toBeLessThanOrEqual(VIEWPORT.width - grid.marginPx);
      expect(y).toBeGreaterThanOrEqual(grid.marginPx);
      expect(y).toBeLessThanOrEqual(VIEWPORT.height - grid.marginPx);
    }
  });

  it("defaults to the ~24x16 grid called out by §6.2", () => {
    expect(DEFAULT_FIELD_GRID.cols).toBe(24);
    expect(DEFAULT_FIELD_GRID.rows).toBe(16);
  });
});

describe("fieldArrowLengthPx", () => {
  it("maps exactly 0 (and negative) magnitude to 0 length", () => {
    expect(fieldArrowLengthPx(0)).toBe(0);
    expect(fieldArrowLengthPx(-1)).toBe(0);
  });

  it("is linear (not log) in magnitude below the clamp", () => {
    const l1 = fieldArrowLengthPx(1);
    const l2 = fieldArrowLengthPx(2);
    const l4 = fieldArrowLengthPx(4);
    expect(l2).toBeCloseTo(2 * l1, 10);
    expect(l4).toBeCloseTo(4 * l1, 10);
  });

  it("clamps at maxLengthPx for large magnitudes", () => {
    const config = DEFAULT_FIELD_SCALE;
    const hugeLength = fieldArrowLengthPx(1e6, config);
    expect(hugeLength).toBe(config.maxLengthPx);
  });
});

describe("computeFieldArrows: uniform wind produces identical arrows (P3.27 validation criterion)", () => {
  it("every grid arrow has the same dx, dy, and magnitude for a spatially-constant wind", () => {
    const wind = new UniformWind(7, -2);
    const scratch = new EnvSample();
    const arrows = computeFieldArrows(wind, IDENTITY_CAMERA, VIEWPORT, 0, scratch);

    expect(arrows.length).toBe(DEFAULT_FIELD_GRID.cols * DEFAULT_FIELD_GRID.rows);
    const first = arrows[0]!;
    expect(first.magnitude).toBeCloseTo(Math.hypot(7, -2), 12);
    for (const arrow of arrows) {
      expect(arrow.dx).toBeCloseTo(first.dx, 12);
      expect(arrow.dy).toBeCloseTo(first.dy, 12);
      expect(arrow.magnitude).toBeCloseTo(first.magnitude, 12);
    }
  });

  it("zero wind produces zero-length arrows (nothing to draw)", () => {
    const scratch = new EnvSample();
    const arrows = computeFieldArrows(new ZeroWind(), IDENTITY_CAMERA, VIEWPORT, 0, scratch);
    for (const arrow of arrows) {
      expect(arrow.dx).toBe(0);
      expect(arrow.dy).toBe(0);
      expect(arrow.magnitude).toBe(0);
    }
  });
});

describe("computeFieldArrows: vortex shows rotation (P3.27 validation criterion)", () => {
  it("arrows sampled east vs. north of the vortex center point in directions rotated 90 degrees apart", () => {
    // IDENTITY_CAMERA centers world (0,0) at the viewport center with scale
    // 1 px/unit, so a 1-column grid samples a single (x=0) column and a
    // 1-row grid samples a single (y=0) row -- precise east/west and
    // north/south probes rather than a heuristic search over the full grid.
    const eastWestGrid: FieldLayerGridConfig = { cols: 2, rows: 1, marginPx: 0 };
    const northSouthGrid: FieldLayerGridConfig = { cols: 1, rows: 2, marginPx: 0 };
    const wind = new GaussianVortexWind(5, 5); // circulation, core radius; centered at world origin
    const scratch = new EnvSample();

    const [west, east] = computeFieldArrows(
      wind,
      IDENTITY_CAMERA,
      VIEWPORT,
      0,
      scratch,
      eastWestGrid,
    );
    const [north, south] = computeFieldArrows(
      wind,
      IDENTITY_CAMERA,
      VIEWPORT,
      0,
      scratch,
      northSouthGrid,
    );

    // Sanity: the four probe points really do land where geometry expects
    // (world x=+/-100 for east/west, world y=+/-100 for north/south) --
    // confirms the grid/camera arithmetic before trusting the rotation
    // assertions below.
    const eastWestPoints = fieldGridScreenPoints(VIEWPORT, eastWestGrid).map((p) =>
      screenToWorld(IDENTITY_CAMERA, VIEWPORT, p),
    );
    expect(eastWestPoints[0]!.x).toBeLessThan(0);
    expect(eastWestPoints[1]!.x).toBeGreaterThan(0);

    // All four probes sit on the same circle (r=100) around the vortex
    // center, so they share the same wind magnitude -- only direction varies.
    expect(east!.magnitude).toBeCloseTo(west!.magnitude, 10);
    expect(north!.magnitude).toBeCloseTo(east!.magnitude, 10);
    expect(south!.magnitude).toBeCloseTo(east!.magnitude, 10);
    expect(east!.magnitude).toBeGreaterThan(0); // a real, nonzero probe -- not a degenerate r=0 sample

    const dir = (arrow: { dx: number; dy: number }) => {
      const len = Math.hypot(arrow.dx, arrow.dy);
      return { ux: arrow.dx / len, uy: arrow.dy / len };
    };
    const eastDir = dir(east!);
    const northDir = dir(north!);
    const westDir = dir(west!);
    const southDir = dir(south!);

    // A rigid vortex rotation: each probe's direction is the previous one
    // rotated 90 degrees (perpendicular, dot ~ 0), and opposite probes
    // (east/west, north/south) point exactly opposite each other (dot ~ -1)
    // -- distinguishing a genuine rotating field from the uniform-wind case
    // above, where every probe shares one direction.
    expect(eastDir.ux * northDir.ux + eastDir.uy * northDir.uy).toBeCloseTo(0, 10);
    expect(eastDir.ux * westDir.ux + eastDir.uy * westDir.uy).toBeCloseTo(-1, 10);
    expect(northDir.ux * southDir.ux + northDir.uy * southDir.uy).toBeCloseTo(-1, 10);
  });
});

describe("fieldLegendTicks", () => {
  it("returns tickCount evenly-spaced magnitudes, the last reaching exactly maxLengthPx", () => {
    const ticks = fieldLegendTicks(DEFAULT_FIELD_SCALE, 4);
    expect(ticks).toHaveLength(4);
    expect(ticks.at(-1)!.lengthPx).toBeCloseTo(DEFAULT_FIELD_SCALE.maxLengthPx, 10);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.magnitude).toBeGreaterThan(ticks[i - 1]!.magnitude);
      expect(ticks[i]!.lengthPx).toBeCloseTo(fieldArrowLengthPx(ticks[i]!.magnitude), 10);
    }
  });
});

class RecordingCanvas implements ForceGlyphCanvas {
  strokeStyle = "";
  fillStyle = "";
  lineWidth = 0;
  beginPathCalls = 0;
  moveToCalls: Array<[number, number]> = [];
  lineToCalls: Array<[number, number]> = [];
  strokeCalls = 0;

  beginPath(): void {
    this.beginPathCalls++;
  }
  moveTo(x: number, y: number): void {
    this.moveToCalls.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.lineToCalls.push([x, y]);
  }
  stroke(): void {
    this.strokeCalls++;
  }
}

describe("drawFieldLayer", () => {
  it("draws one arrow (shaft + two head strokes) per nonzero grid point", () => {
    const canvas = new RecordingCanvas();
    const grid: FieldLayerGridConfig = { cols: 3, rows: 2, marginPx: 10 };
    drawFieldLayer(canvas, IDENTITY_CAMERA, VIEWPORT, new UniformWind(5, 0), 0, new EnvSample(), {
      grid,
    });

    const arrowCount = grid.cols * grid.rows;
    // drawArrow issues 2 beginPath/stroke pairs per arrow: one for the
    // shaft, one for the two-line arrowhead (force-glyphs.ts's drawArrow).
    expect(canvas.beginPathCalls).toBe(arrowCount * 2);
    expect(canvas.strokeCalls).toBe(arrowCount * 2);
  });

  it("draws nothing for a zero wind field", () => {
    const canvas = new RecordingCanvas();
    drawFieldLayer(canvas, IDENTITY_CAMERA, VIEWPORT, new ZeroWind(), 0, new EnvSample());

    expect(canvas.beginPathCalls).toBe(0);
    expect(canvas.moveToCalls).toHaveLength(0);
  });

  it("uses the configured color and line width", () => {
    const canvas = new RecordingCanvas();
    drawFieldLayer(canvas, IDENTITY_CAMERA, VIEWPORT, new UniformWind(3, 3), 0, new EnvSample(), {
      color: "#abcdef",
      lineWidth: 2.5,
      grid: { cols: 1, rows: 1, marginPx: 0 },
    });

    expect(canvas.strokeStyle).toBe("#abcdef");
    expect(canvas.lineWidth).toBe(2.5);
  });
});

describe("WindSampleSource accepts a full Environment, not just a bare WindModel", () => {
  it("a ResolvedModel's ctx.env (Environment, not WindModel) drives the field layer identically to its own wind component", () => {
    const wind = new UniformWind(4, -1);
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), wind);
    const scratch = new EnvSample();

    const viaEnv = computeFieldArrows(env, IDENTITY_CAMERA, VIEWPORT, 0, scratch, {
      cols: 1,
      rows: 1,
      marginPx: 0,
    });
    const viaWind = computeFieldArrows(wind, IDENTITY_CAMERA, VIEWPORT, 0, scratch, {
      cols: 1,
      rows: 1,
      marginPx: 0,
    });

    expect(viaEnv[0]!.dx).toBeCloseTo(viaWind[0]!.dx, 12);
    expect(viaEnv[0]!.dy).toBeCloseTo(viaWind[0]!.dy, 12);
    expect(viaEnv[0]!.magnitude).toBeCloseTo(viaWind[0]!.magnitude, 12);
  });
});
