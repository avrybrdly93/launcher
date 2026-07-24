/**
 * `FieldLayer` (§6.1 WorldLayer: "wind vector field (grid arrows /
 * streamlines)"; §6.2 "wind sampled on a screen-anchored grid (~24x16
 * arrows), arrow length ∝ magnitude with a max-length clamp and a magnitude
 * legend"; P3.27).
 *
 * "Screen-anchored" means the grid is laid out in *screen* space first
 * ({@link computeFieldGridScreenPoints}, evenly spaced across the viewport
 * with a margin) and each point is then mapped back to world space via
 * {@link screenToWorld} to sample the live `WindModel` (`@ballista/engine`,
 * P1.33's seam) -- unlike `TrajectoryLayer`'s world-anchored geometry, the
 * arrow *positions* stay fixed on screen as the camera pans/zooms, only
 * their sampled wind vectors change. This is what keeps the arrow count
 * constant and legible regardless of zoom level.
 *
 * Mirrors `force-glyphs.ts`'s pure-computation + minimal-canvas-interface
 * split: grid/sample/scale functions are pure and unit-tested directly (no
 * `Path2D`, so unlike `trajectory-layer.ts` the draw pass is directly
 * testable too), {@link drawFieldLayer} is the thin rendering pass over
 * them. Direction-vector math (world → screen unit direction, with the
 * y-flip §6.1 calls out as living only in the camera transform) is shared
 * with `force-glyphs.ts`'s {@link worldForceDirectionToScreen} rather than
 * re-derived here -- wind vectors and force vectors are both plain
 * world-space vectors under the same camera.
 */

import type { EnvSample, WindModel } from "@ballista/engine";
import type { Camera2DState, ScreenPoint, Viewport } from "./camera2d.js";
import { screenToWorld } from "./camera2d.js";
import { worldForceDirectionToScreen } from "./force-glyphs.js";

/** Screen-anchored grid layout: `cols x rows` points, inset `marginPx` from each viewport edge. */
export interface FieldGridConfig {
  readonly cols: number;
  readonly rows: number;
  readonly marginPx: number;
}

/** §6.2's "~24x16 arrows". */
export const DEFAULT_FIELD_GRID: FieldGridConfig = Object.freeze({
  cols: 24,
  rows: 16,
  marginPx: 24,
});

/**
 * The `cols x rows` screen positions {@link sampleFieldArrows} samples wind
 * at, evenly spaced across `viewport` inset by `config.marginPx` on every
 * edge. Pure function of `viewport`/`config` alone -- independent of the
 * camera, which is exactly what "screen-anchored" means: these positions
 * don't move when the camera pans or zooms.
 */
export function computeFieldGridScreenPoints(
  viewport: Viewport,
  config: FieldGridConfig = DEFAULT_FIELD_GRID,
): ScreenPoint[] {
  const { cols, rows, marginPx } = config;
  const usableWidth = Math.max(viewport.width - 2 * marginPx, 0);
  const usableHeight = Math.max(viewport.height - 2 * marginPx, 0);

  const points: ScreenPoint[] = [];
  for (let row = 0; row < rows; row++) {
    const fy = rows === 1 ? 0.5 : row / (rows - 1);
    const y = marginPx + fy * usableHeight;
    for (let col = 0; col < cols; col++) {
      const fx = cols === 1 ? 0.5 : col / (cols - 1);
      const x = marginPx + fx * usableWidth;
      points.push({ x, y });
    }
  }
  return points;
}

/** One sampled grid point: its screen anchor plus the wind vector (m/s, world-space) and magnitude sampled there. */
export interface FieldArrow {
  readonly screenX: number;
  readonly screenY: number;
  readonly wx: number;
  readonly wy: number;
  readonly magnitude: number;
}

/**
 * Samples `wind` at time `t` over {@link computeFieldGridScreenPoints}'s
 * screen-anchored grid, mapping each screen point to world space
 * (`screenToWorld`) before sampling -- the grid stays put on screen while
 * the world position it queries follows the camera. `scratch` is a
 * caller-owned `EnvSample` reused across every grid point (mirrors
 * `WindModel.sample`'s own no-allocation contract, §6.5); only `wx`/`wy`
 * are read back, matching every other `WindModel` consumer in the engine
 * (`environment.ts`'s composition, force models).
 */
export function sampleFieldArrows(
  wind: WindModel,
  t: number,
  camera: Camera2DState,
  viewport: Viewport,
  scratch: EnvSample,
  config: FieldGridConfig = DEFAULT_FIELD_GRID,
): FieldArrow[] {
  const points = computeFieldGridScreenPoints(viewport, config);
  return points.map((screen) => {
    const world = screenToWorld(camera, viewport, screen);
    wind.sample(t, world.x, world.y, scratch);
    const wx = scratch.wx;
    const wy = scratch.wy;
    return { screenX: screen.x, screenY: screen.y, wx, wy, magnitude: Math.hypot(wx, wy) };
  });
}

/** Linear length-mapping configuration for {@link linearScaleArrowLength}/{@link fieldArrowLegendTicks}. */
export interface FieldArrowScaleConfig {
  /** Wind speed (m/s) at or above which an arrow renders at `maxLengthPx` -- the "max-length clamp" (§6.2). */
  readonly maxMagnitude: number;
  readonly maxLengthPx: number;
}

export const DEFAULT_FIELD_ARROW_SCALE: FieldArrowScaleConfig = Object.freeze({
  maxMagnitude: 25, // m/s -- a brisk gale; comfortably above the scenario library's gust amplitudes
  maxLengthPx: 18,
});

/**
 * Maps a wind speed (m/s, >= 0) to an on-screen arrow length, linearly
 * scaled between `0` and `config.maxMagnitude` and clamped to
 * `config.maxLengthPx` above it (§6.2 "arrow length proportional to
 * magnitude with a max-length clamp" -- unlike the force glyphs'
 * log-scaling, P3.14, wind speeds don't span enough decades to need it).
 * Exactly `0` maps to `0` -- still air draws no arrow.
 */
export function linearScaleArrowLength(
  magnitude: number,
  config: FieldArrowScaleConfig = DEFAULT_FIELD_ARROW_SCALE,
): number {
  if (!(magnitude > 0)) return 0;
  const fraction = magnitude / config.maxMagnitude;
  const clampedFraction = fraction > 1 ? 1 : fraction;
  return clampedFraction * config.maxLengthPx;
}

/** One legend entry: a representative wind speed and the arrow length it maps to. */
export interface FieldArrowLegendTick {
  readonly magnitude: number;
  readonly lengthPx: number;
}

/**
 * Reference wind speeds evenly spaced up to `config.maxMagnitude`
 * (`count` of them, `maxMagnitude` included), with their mapped lengths --
 * what a legend renders so a viewer can read an arrow's length back into
 * m/s (§6.2 "magnitude legend").
 */
export function fieldArrowLegendTicks(
  config: FieldArrowScaleConfig = DEFAULT_FIELD_ARROW_SCALE,
  count = 3,
): readonly FieldArrowLegendTick[] {
  const ticks: FieldArrowLegendTick[] = [];
  for (let i = 1; i <= count; i++) {
    const magnitude = (config.maxMagnitude * i) / count;
    ticks.push({ magnitude, lengthPx: linearScaleArrowLength(magnitude, config) });
  }
  return ticks;
}

/** The subset of `CanvasRenderingContext2D` `drawFieldLayer` needs. */
export interface FieldLayerCanvas {
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

export interface FieldLayerOptions {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly alpha?: number;
}

const DEFAULT_FIELD_LAYER_COLOR = "#1c7ed6";
const DEFAULT_FIELD_LAYER_LINE_WIDTH = 1;
const DEFAULT_FIELD_LAYER_ALPHA = 0.55;
const ARROWHEAD_LENGTH_PX = 4;
const ARROWHEAD_ANGLE_RAD = Math.PI / 7;

function drawFieldArrow(
  canvas: FieldLayerCanvas,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
): void {
  const x1 = x0 + dx;
  const y1 = y0 + dy;

  canvas.beginPath();
  canvas.moveTo(x0, y0);
  canvas.lineTo(x1, y1);
  canvas.stroke();

  const angle = Math.atan2(dy, dx);
  canvas.beginPath();
  canvas.moveTo(x1, y1);
  canvas.lineTo(
    x1 - ARROWHEAD_LENGTH_PX * Math.cos(angle - ARROWHEAD_ANGLE_RAD),
    y1 - ARROWHEAD_LENGTH_PX * Math.sin(angle - ARROWHEAD_ANGLE_RAD),
  );
  canvas.moveTo(x1, y1);
  canvas.lineTo(
    x1 - ARROWHEAD_LENGTH_PX * Math.cos(angle + ARROWHEAD_ANGLE_RAD),
    y1 - ARROWHEAD_LENGTH_PX * Math.sin(angle + ARROWHEAD_ANGLE_RAD),
  );
  canvas.stroke();
}

/**
 * Draws one arrow per sampled grid point, rooted at its screen anchor and
 * pointing along the sampled wind direction with length from
 * {@link linearScaleArrowLength} -- a point where the wind is exactly calm
 * (`magnitude === 0`) draws nothing. Restores `globalAlpha` to what it was
 * before this call (mirrors `ghost-layer.ts`'s "never leak style onto the
 * next layer" discipline, §6.1 frame-loop).
 */
export function drawFieldLayer(
  canvas: FieldLayerCanvas,
  arrows: readonly FieldArrow[],
  scaleConfig: FieldArrowScaleConfig = DEFAULT_FIELD_ARROW_SCALE,
  options: FieldLayerOptions = {},
): void {
  const previousAlpha = canvas.globalAlpha;
  canvas.strokeStyle = options.color ?? DEFAULT_FIELD_LAYER_COLOR;
  canvas.lineWidth = options.lineWidth ?? DEFAULT_FIELD_LAYER_LINE_WIDTH;
  canvas.globalAlpha = options.alpha ?? DEFAULT_FIELD_LAYER_ALPHA;

  for (const arrow of arrows) {
    const lengthPx = linearScaleArrowLength(arrow.magnitude, scaleConfig);
    if (lengthPx <= 0) continue;

    const { dx, dy } = worldForceDirectionToScreen(arrow.wx, arrow.wy);
    drawFieldArrow(canvas, arrow.screenX, arrow.screenY, dx * lengthPx, dy * lengthPx);
  }

  canvas.globalAlpha = previousAlpha;
}
