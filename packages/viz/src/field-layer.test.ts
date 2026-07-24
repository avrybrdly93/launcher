import { describe, expect, it } from "vitest";
import { EnvSample, GaussianVortexWind, UniformWind } from "@ballista/engine";
import { IDENTITY_CAMERA, type Camera2DState, type Viewport } from "./camera2d.js";
import {
  computeFieldGridScreenPoints,
  DEFAULT_FIELD_ARROW_SCALE,
  DEFAULT_FIELD_GRID,
  drawFieldLayer,
  fieldArrowLegendTicks,
  linearScaleArrowLength,
  sampleFieldArrows,
  type FieldLayerCanvas,
} from "./field-layer.js";

const VIEWPORT: Viewport = { width: 480, height: 320 };

describe("computeFieldGridScreenPoints", () => {
  it("lays out cols x rows points inset from every viewport edge", () => {
    const config = { cols: 4, rows: 3, marginPx: 10 };
    const points = computeFieldGridScreenPoints(VIEWPORT, config);

    expect(points).toHaveLength(12);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(10);
      expect(p.x).toBeLessThanOrEqual(VIEWPORT.width - 10);
      expect(p.y).toBeGreaterThanOrEqual(10);
      expect(p.y).toBeLessThanOrEqual(VIEWPORT.height - 10);
    }

    // Corners of the grid land exactly on the inset margin.
    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points[points.length - 1]).toEqual({ x: VIEWPORT.width - 10, y: VIEWPORT.height - 10 });
  });

  it("defaults to the ~24x16 grid called out in §6.2", () => {
    const points = computeFieldGridScreenPoints(VIEWPORT);
    expect(points).toHaveLength(DEFAULT_FIELD_GRID.cols * DEFAULT_FIELD_GRID.rows);
  });
});

describe("sampleFieldArrows: uniform wind (P3.27 validation criterion)", () => {
  it("uniform wind produces identical arrows (same wx/wy/magnitude) at every grid point, regardless of camera pan/zoom", () => {
    const wind = new UniformWind(7, -2);
    const scratch = new EnvSample();

    for (const camera of [
      IDENTITY_CAMERA,
      { centerX: 50, centerY: -30, scaleX: 1, scaleY: 1 } as Camera2DState,
      { centerX: 0, centerY: 0, scaleX: 3.5, scaleY: 0.8 } as Camera2DState,
    ]) {
      const arrows = sampleFieldArrows(wind, 0, camera, VIEWPORT, scratch);
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) {
        expect(arrow.wx).toBe(7);
        expect(arrow.wy).toBe(-2);
        expect(arrow.magnitude).toBeCloseTo(Math.hypot(7, 2), 12);
      }

      // Identical vectors clamp to identical on-screen lengths too.
      const lengths = new Set(arrows.map((a) => linearScaleArrowLength(a.magnitude)));
      expect(lengths.size).toBe(1);
    }
  });
});

describe("sampleFieldArrows: Gaussian vortex shows rotation (P3.27 validation criterion)", () => {
  it("arrows are tangential (perpendicular to the radius from the vortex center) and rotate around it", () => {
    const centerX = 0;
    const centerY = 0;
    const wind = new GaussianVortexWind(200, 5, centerX, centerY);
    const scratch = new EnvSample();
    const camera = IDENTITY_CAMERA;

    const arrows = sampleFieldArrows(wind, 0, camera, VIEWPORT, scratch, {
      cols: 8,
      rows: 6,
      marginPx: 20,
    });

    const nonZero = arrows.filter((a) => a.magnitude > 1e-9);
    expect(nonZero.length).toBeGreaterThan(10);

    for (const arrow of nonZero) {
      // Radius vector from the vortex center, in world space (matches screenToWorld's y-flip).
      const worldX = camera.centerX + (arrow.screenX - VIEWPORT.width / 2) / camera.scaleX;
      const worldY = camera.centerY - (arrow.screenY - VIEWPORT.height / 2) / camera.scaleY;
      const rx = worldX - centerX;
      const ry = worldY - centerY;
      const radialDot = (rx * arrow.wx + ry * arrow.wy) / (Math.hypot(rx, ry) * arrow.magnitude);
      expect(Math.abs(radialDot)).toBeLessThan(1e-9);
    }

    // Directions actually vary from point to point -- a rotating field, not
    // a uniform one: not every arrow points the same way.
    const angles = new Set(nonZero.map((a) => Math.atan2(a.wy, a.wx).toFixed(3)));
    expect(angles.size).toBeGreaterThan(1);
  });
});

describe("linearScaleArrowLength", () => {
  it("maps 0 to 0 and clamps at/above maxMagnitude to maxLengthPx", () => {
    expect(linearScaleArrowLength(0)).toBe(0);
    expect(linearScaleArrowLength(-1)).toBe(0);
    expect(linearScaleArrowLength(DEFAULT_FIELD_ARROW_SCALE.maxMagnitude)).toBe(
      DEFAULT_FIELD_ARROW_SCALE.maxLengthPx,
    );
    expect(linearScaleArrowLength(DEFAULT_FIELD_ARROW_SCALE.maxMagnitude * 10)).toBe(
      DEFAULT_FIELD_ARROW_SCALE.maxLengthPx,
    );
  });

  it("scales linearly (not logarithmically) between 0 and maxMagnitude", () => {
    const config = { maxMagnitude: 20, maxLengthPx: 10 };
    expect(linearScaleArrowLength(10, config)).toBeCloseTo(5, 10);
    expect(linearScaleArrowLength(5, config)).toBeCloseTo(2.5, 10);
  });
});

describe("fieldArrowLegendTicks", () => {
  it("returns count evenly spaced magnitudes up to maxMagnitude, matching linearScaleArrowLength", () => {
    const config = { maxMagnitude: 30, maxLengthPx: 15 };
    const ticks = fieldArrowLegendTicks(config, 3);

    expect(ticks).toEqual([
      { magnitude: 10, lengthPx: 5 },
      { magnitude: 20, lengthPx: 10 },
      { magnitude: 30, lengthPx: 15 },
    ]);
  });
});

class RecordingCanvas implements FieldLayerCanvas {
  strokeStyle = "";
  lineWidth = 0;
  globalAlpha = 1;
  segments: Array<{ x: number; y: number }[]> = [];
  private current: { x: number; y: number }[] = [];

  beginPath(): void {
    this.current = [];
  }
  moveTo(x: number, y: number): void {
    this.current.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.current.push({ x, y });
  }
  stroke(): void {
    this.segments.push(this.current);
  }
}

describe("drawFieldLayer", () => {
  it("draws nothing for a calm arrow but a shaft + arrowhead for a non-zero one, and restores globalAlpha", () => {
    const canvas = new RecordingCanvas();
    const previousAlpha = canvas.globalAlpha;

    drawFieldLayer(canvas, [
      { screenX: 10, screenY: 10, wx: 0, wy: 0, magnitude: 0 },
      { screenX: 50, screenY: 50, wx: 5, wy: 0, magnitude: 5 },
    ]);

    // One shaft stroke() + one stroke() covering both arrowhead barbs.
    expect(canvas.segments).toHaveLength(2);
    expect(canvas.segments[0]).toEqual([
      { x: 50, y: 50 },
      { x: 50 + linearScaleArrowLength(5), y: 50 },
    ]);
    expect(canvas.globalAlpha).toBe(previousAlpha);
  });
});
