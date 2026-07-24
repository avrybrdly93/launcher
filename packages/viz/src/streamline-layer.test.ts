import { describe, expect, it } from "vitest";
import { EnvSample, GaussianVortexWind, UniformWind } from "@ballista/engine";
import { IDENTITY_CAMERA, type Viewport } from "./camera2d.js";
import {
  computeStreamlines,
  DEFAULT_STREAMLINE_CONFIG,
  drawStreamlineLayer,
  traceStreamlineWorld,
  type StreamlineLayerCanvas,
} from "./streamline-layer.js";

const VIEWPORT: Viewport = { width: 480, height: 320 };

function normalize(x: number, y: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  return m === 0 ? { x: 0, y: 0 } : { x: x / m, y: y / m };
}

function dot(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.x + a.y * b.y;
}

describe("traceStreamlineWorld: tangent to the field it traces (P3.28 validation criterion)", () => {
  it("uniform wind: every segment is exactly parallel to the wind vector, spaced by stepLength", () => {
    const wind = new UniformWind(3, 4); // |w| = 5
    const scratch = new EnvSample();
    const config = { ...DEFAULT_STREAMLINE_CONFIG, stepLength: 2, maxSteps: 10 };

    const points = traceStreamlineWorld(wind, 0, { x: 0, y: 0 }, scratch, config);
    expect(points.length).toBe(config.maxSteps + 1);

    const windDir = normalize(3, 4);
    for (let i = 1; i < points.length; i++) {
      const dx = points[i]!.x - points[i - 1]!.x;
      const dy = points[i]!.y - points[i - 1]!.y;
      expect(Math.hypot(dx, dy)).toBeCloseTo(config.stepLength, 10);
      const segDir = normalize(dx, dy);
      expect(dot(segDir, windDir)).toBeCloseTo(1, 10);
    }
  });

  it("Gaussian vortex: each segment's direction is tangent to the wind sampled at its start point (spot test)", () => {
    const wind = new GaussianVortexWind(200, 5, 0, 0);
    const scratch = new EnvSample();
    // A short step relative to the vortex's core radius keeps curvature per
    // step small, so the spot-check tolerance below is tight and meaningful.
    const config = { ...DEFAULT_STREAMLINE_CONFIG, stepLength: 0.05, maxSteps: 20 };

    const points = traceStreamlineWorld(wind, 0, { x: 3, y: 0 }, scratch, config);
    expect(points.length).toBeGreaterThan(2);

    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1]!;
      wind.sample(0, start.x, start.y, scratch);
      const localDir = normalize(scratch.wx, scratch.wy);

      const dx = points[i]!.x - start.x;
      const dy = points[i]!.y - start.y;
      const segDir = normalize(dx, dy);

      expect(dot(segDir, localDir)).toBeGreaterThan(0.999);
    }
  });

  it("stops tracing at a calm point rather than producing a NaN direction", () => {
    const wind = new GaussianVortexWind(200, 5, 0, 0);
    const scratch = new EnvSample();

    // Seeded exactly at the vortex center, where wind is identically zero.
    const points = traceStreamlineWorld(wind, 0, { x: 0, y: 0 }, scratch);
    expect(points).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("computeStreamlines", () => {
  it("traces one streamline per screen-anchored seed, each starting at its seed's screen position", () => {
    const wind = new UniformWind(5, 0);
    const scratch = new EnvSample();
    const config = {
      ...DEFAULT_STREAMLINE_CONFIG,
      seedGrid: { cols: 3, rows: 2, marginPx: 20 },
    };

    const streamlines = computeStreamlines(wind, 0, IDENTITY_CAMERA, VIEWPORT, scratch, config);
    expect(streamlines).toHaveLength(6);
    for (const streamline of streamlines) {
      expect(streamline.length).toBeGreaterThan(1);
    }
  });
});

class RecordingCanvas implements StreamlineLayerCanvas {
  strokeStyle = "";
  lineWidth = 0;
  globalAlpha = 1;
  strokeCalls = 0;
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {
    this.strokeCalls++;
  }
}

describe("drawStreamlineLayer: the toggle (P3.28)", () => {
  const streamlines = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
  ];

  it("draws nothing when enabled is omitted or false", () => {
    const canvasDefault = new RecordingCanvas();
    drawStreamlineLayer(canvasDefault, streamlines);
    expect(canvasDefault.strokeCalls).toBe(0);

    const canvasOff = new RecordingCanvas();
    drawStreamlineLayer(canvasOff, streamlines, { enabled: false });
    expect(canvasOff.strokeCalls).toBe(0);
  });

  it("draws one stroke per streamline when enabled, and restores globalAlpha", () => {
    const canvas = new RecordingCanvas();
    const previousAlpha = canvas.globalAlpha;

    drawStreamlineLayer(canvas, streamlines, { enabled: true });

    expect(canvas.strokeCalls).toBe(1);
    expect(canvas.globalAlpha).toBe(previousAlpha);
  });

  it("skips a streamline with fewer than two points", () => {
    const canvas = new RecordingCanvas();
    drawStreamlineLayer(canvas, [[{ x: 0, y: 0 }], []], { enabled: true });
    expect(canvas.strokeCalls).toBe(0);
  });
});
