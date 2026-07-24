import { describe, expect, it } from "vitest";
import { EnvSample, GaussianVortexWind, UniformWind } from "@ballista/engine";
import { IDENTITY_CAMERA, screenToWorld, type Viewport } from "./camera2d.js";
import { worldForceDirectionToScreen } from "./force-glyphs.js";
import {
  computeStreamlines,
  DEFAULT_STREAMLINE_CONFIG,
  DEFAULT_STREAMLINE_SEED_GRID,
  drawStreamlineOverlay,
  traceStreamline,
  type StreamlineCanvas,
  type StreamlineConfig,
} from "./streamline-overlay.js";

const VIEWPORT: Viewport = { width: 400, height: 400 };

describe("traceStreamline: tangent to the field's arrow direction (P3.28 validation criterion)", () => {
  it("in a uniform wind, every step lands exactly along the single constant direction", () => {
    const wind = new UniformWind(3, 4); // direction (3,4)/5, deliberately not axis-aligned
    const scratch = new EnvSample();
    const origin = { x: 100, y: 250 };
    const config: StreamlineConfig = { stepPx: 10, maxSteps: 12, minMagnitude: 1e-6 };

    const line = traceStreamline(wind, IDENTITY_CAMERA, VIEWPORT, 0, scratch, origin, config);
    expect(line.length).toBe(config.maxSteps + 1);

    const expected = worldForceDirectionToScreen(3, 4);
    for (let i = 1; i < line.length; i++) {
      const segDx = line[i]!.x - line[i - 1]!.x;
      const segDy = line[i]!.y - line[i - 1]!.y;
      expect(Math.hypot(segDx, segDy)).toBeCloseTo(config.stepPx, 10);
      // Every segment is exactly parallel to the field's own screen direction --
      // a constant field makes RK2 collapse to straight-line stepping.
      expect(segDx).toBeCloseTo(expected.dx * config.stepPx, 10);
      expect(segDy).toBeCloseTo(expected.dy * config.stepPx, 10);
    }
  });

  it("in a curved (vortex) field, each segment's direction stays close to the field arrow sampled at its start point", () => {
    const wind = new GaussianVortexWind(6, 40, 0, 0);
    const scratch = new EnvSample();
    // A seed well outside the core, off-axis so the field is genuinely
    // curving under the streamline rather than lying on a straight radial.
    const origin = { x: 250, y: 170 };
    const config: StreamlineConfig = { stepPx: 4, maxSteps: 20, minMagnitude: 1e-6 };

    const line = traceStreamline(wind, IDENTITY_CAMERA, VIEWPORT, 0, scratch, origin, config);

    for (let i = 1; i < line.length; i++) {
      const start = line[i - 1]!;
      const segDx = line[i]!.x - start.x;
      const segDy = line[i]!.y - start.y;
      const segLen = Math.hypot(segDx, segDy);

      const worldStart = screenToWorld(IDENTITY_CAMERA, VIEWPORT, start);
      wind.sample(0, worldStart.x, worldStart.y, scratch);
      const arrowDir = worldForceDirectionToScreen(scratch.wx, scratch.wy);

      // Normalized dot product between the traced segment and the arrow
      // direction at its own start point -- "tangent", not necessarily
      // identical (RK2 legitimately curves *toward* the midpoint sample),
      // so this allows a small deviation rather than demanding exact
      // parallelism the way the uniform-wind case above does.
      const dot = (segDx * arrowDir.dx + segDy * arrowDir.dy) / (segLen * 1);
      expect(dot).toBeGreaterThan(0.95);
    }
  });

  it("stops tracing (fewer than maxSteps points) once the field vanishes, rather than producing NaN steps", () => {
    const wind = new GaussianVortexWind(6, 40, 0, 0);
    const scratch = new EnvSample();
    const config: StreamlineConfig = { stepPx: 5, maxSteps: 50, minMagnitude: 1e6 }; // absurdly high floor: every sample "vanishes"
    const line = traceStreamline(
      wind,
      IDENTITY_CAMERA,
      VIEWPORT,
      0,
      scratch,
      { x: 200, y: 200 },
      config,
    );
    expect(line).toEqual([{ x: 200, y: 200 }]);
  });
});

describe("computeStreamlines", () => {
  it("traces one streamline per seed of the (sparser than the arrow grid) seed grid", () => {
    const wind = new UniformWind(2, 0);
    const scratch = new EnvSample();
    const lines = computeStreamlines(wind, IDENTITY_CAMERA, VIEWPORT, 0, scratch);
    expect(lines.length).toBe(
      DEFAULT_STREAMLINE_SEED_GRID.cols * DEFAULT_STREAMLINE_SEED_GRID.rows,
    );
    expect(lines.length).toBeLessThan(24 * 16); // sparser than FieldLayer's default arrow grid
    for (const line of lines) {
      expect(line.length).toBe(DEFAULT_STREAMLINE_CONFIG.maxSteps + 1);
    }
  });
});

class RecordingCanvas implements StreamlineCanvas {
  strokeStyle = "";
  lineWidth = 0;
  globalAlpha = 1;
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

describe("drawStreamlineOverlay: the toggle", () => {
  const lines = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ],
  ];

  it("draws nothing when disabled, regardless of the traced lines", () => {
    const canvas = new RecordingCanvas();
    drawStreamlineOverlay(canvas, lines, false);
    expect(canvas.beginPathCalls).toBe(0);
    expect(canvas.strokeCalls).toBe(0);
  });

  it("draws one path per streamline when enabled, restoring globalAlpha afterward", () => {
    const canvas = new RecordingCanvas();
    canvas.globalAlpha = 1;
    drawStreamlineOverlay(canvas, lines, true, { alpha: 0.3 });

    expect(canvas.beginPathCalls).toBe(1);
    expect(canvas.strokeCalls).toBe(1);
    expect(canvas.moveToCalls).toEqual([[0, 0]]);
    expect(canvas.lineToCalls).toEqual([
      [10, 10],
      [20, 5],
    ]);
    expect(canvas.globalAlpha).toBe(1); // restored, not left at the overlay's 0.3
  });

  it("skips a degenerate single-point streamline (nothing to connect)", () => {
    const canvas = new RecordingCanvas();
    drawStreamlineOverlay(canvas, [[{ x: 5, y: 5 }]], true);
    expect(canvas.beginPathCalls).toBe(0);
  });
});
