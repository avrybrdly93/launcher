/**
 * `FieldLayer` (§6.1 WorldLayer: "wind vector field (grid arrows /
 * streamlines)"; §6.2 "wind sampled on a screen-anchored grid (~24x16
 * arrows), arrow length ∝ magnitude with a max-length clamp and a magnitude
 * legend"; P3.27).
 *
 * The grid is screen-anchored, not world-anchored: arrow origins sit at even
 * screen-pixel steps across the viewport ({@link fieldGridScreenPoints}), and
 * each origin's *world* position (what actually gets sampled) is derived
 * from the camera every call via `screenToWorld` -- so panning/zooming
 * redistributes sample points across the visible field rather than leaving a
 * fixed set of world-space arrows to drift off-camera (mirrors
 * `axes-layer.ts`'s "ticks recomputed from the camera every call").
 *
 * Arrow length is a *linear* scale of wind speed with a hard clamp -- unlike
 * `ForceGlyphLayer`'s log scale (§6.2's explicit distinction): wind speeds in
 * these scenarios span a narrow few-decade range, not the many-decade spread
 * of force magnitudes, so log compression buys nothing and a linear mapping
 * reads more directly as "this many m/s".
 *
 * {@link WindSampleSource} is satisfied structurally by both a bare
 * `WindModel` and a full `Environment` (`ResolvedModel.ctx.env`) -- their
 * `sample(t, x, y, out)` signatures are identical, so a caller that already
 * holds a resolved scenario's `ctx.env` needs no separate wind-only object
 * to drive this layer.
 */

import type { EnvSample } from "@ballista/engine";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { screenToWorld } from "./camera2d.js";
import { drawArrow, worldForceDirectionToScreen, type ForceGlyphCanvas } from "./force-glyphs.js";

/** The minimal shape this layer needs to sample wind: matches both `WindModel` and `Environment`. */
export interface WindSampleSource {
  sample(t: number, x: number, y: number, out: EnvSample): void;
}

/** One arrow's screen-space origin, already-scaled offset, and the raw wind magnitude (m/s) it was derived from. */
export interface FieldArrow {
  readonly originX: number;
  readonly originY: number;
  readonly dx: number;
  readonly dy: number;
  readonly magnitude: number;
}

/** Screen-anchored grid layout: `cols` x `rows` arrow origins, evenly spaced within `marginPx` of the viewport edges. */
export interface FieldLayerGridConfig {
  readonly cols: number;
  readonly rows: number;
  readonly marginPx: number;
}

/** §6.2's "~24x16 arrows". */
export const DEFAULT_FIELD_GRID: FieldLayerGridConfig = Object.freeze({
  cols: 24,
  rows: 16,
  marginPx: 24,
});

/** Linear magnitude-to-length mapping: `pxPerMps` pixels per m/s, clamped at `maxLengthPx`. */
export interface FieldLayerScaleConfig {
  readonly pxPerMps: number;
  readonly maxLengthPx: number;
}

export const DEFAULT_FIELD_SCALE: FieldLayerScaleConfig = Object.freeze({
  pxPerMps: 3,
  maxLengthPx: 28,
});

/** Maps a wind speed (m/s, >= 0) to an on-screen arrow length: linear, clamped to `maxLengthPx` (§6.2 "arrow length ∝ magnitude with a max-length clamp"). */
export function fieldArrowLengthPx(
  magnitude: number,
  config: FieldLayerScaleConfig = DEFAULT_FIELD_SCALE,
): number {
  if (!(magnitude > 0)) return 0;
  return Math.min(magnitude * config.pxPerMps, config.maxLengthPx);
}

/** The `cols` x `rows` grid-cell-center screen points `computeFieldArrows` samples from, in row-major order. */
export function fieldGridScreenPoints(
  viewport: Viewport,
  grid: FieldLayerGridConfig = DEFAULT_FIELD_GRID,
): { x: number; y: number }[] {
  const { cols, rows, marginPx } = grid;
  const usableWidth = Math.max(viewport.width - 2 * marginPx, 0);
  const usableHeight = Math.max(viewport.height - 2 * marginPx, 0);

  const points: { x: number; y: number }[] = [];
  for (let j = 0; j < rows; j++) {
    const y = marginPx + ((j + 0.5) / rows) * usableHeight;
    for (let i = 0; i < cols; i++) {
      const x = marginPx + ((i + 0.5) / cols) * usableWidth;
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * Samples `wind` at time `t` under every grid point in `viewport` (via
 * `screenToWorld`), returning each point's {@link FieldArrow}. A grid point
 * where the sampled wind is exactly `(0, 0)` gets `dx = dy = magnitude = 0`
 * -- nothing to draw, same "zero maps to zero, not the floor length"
 * convention as `logScaleGlyphLength`. `scratch` is a caller-owned
 * `EnvSample` reused across every sample so this allocates nothing but the
 * returned array (§6.5).
 */
export function computeFieldArrows(
  wind: WindSampleSource,
  camera: Camera2DState,
  viewport: Viewport,
  t: number,
  scratch: EnvSample,
  grid: FieldLayerGridConfig = DEFAULT_FIELD_GRID,
  scaleConfig: FieldLayerScaleConfig = DEFAULT_FIELD_SCALE,
): FieldArrow[] {
  return fieldGridScreenPoints(viewport, grid).map((point) => {
    const world = screenToWorld(camera, viewport, point);
    wind.sample(t, world.x, world.y, scratch);

    const magnitude = Math.hypot(scratch.wx, scratch.wy);
    const { dx, dy } = worldForceDirectionToScreen(scratch.wx, scratch.wy);
    const lengthPx = fieldArrowLengthPx(magnitude, scaleConfig);

    return { originX: point.x, originY: point.y, dx: dx * lengthPx, dy: dy * lengthPx, magnitude };
  });
}

/** One magnitude legend entry: a representative wind speed and the arrow length it maps to. */
export interface FieldLegendTick {
  readonly magnitude: number;
  readonly lengthPx: number;
}

/**
 * `tickCount` reference magnitudes evenly spaced up to the speed at which
 * the clamp first engages (`maxLengthPx / pxPerMps`), with their mapped
 * lengths -- what a legend renders so a viewer can read an arrow's length
 * back into m/s (§6.2 "magnitude legend").
 */
export function fieldLegendTicks(
  config: FieldLayerScaleConfig = DEFAULT_FIELD_SCALE,
  tickCount = 4,
): readonly FieldLegendTick[] {
  const referenceMax = config.maxLengthPx / config.pxPerMps;
  const ticks: FieldLegendTick[] = [];
  for (let i = 1; i <= tickCount; i++) {
    const magnitude = (referenceMax * i) / tickCount;
    ticks.push({ magnitude, lengthPx: fieldArrowLengthPx(magnitude, config) });
  }
  return ticks;
}

export interface FieldLayerOptions {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly grid?: FieldLayerGridConfig;
  readonly scale?: FieldLayerScaleConfig;
}

const DEFAULT_FIELD_COLOR = "#1c7ed6";
const DEFAULT_FIELD_LINE_WIDTH = 1;

/**
 * Draws one linearly-scaled arrow per grid point where the sampled wind is
 * nonzero (§6.1 WorldLayer FieldLayer). Reuses {@link drawArrow}'s shaft +
 * arrowhead geometry from `force-glyphs.ts` -- the same shape, just fed a
 * linear rather than log-scaled length.
 */
export function drawFieldLayer(
  canvas: ForceGlyphCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  wind: WindSampleSource,
  t: number,
  scratch: EnvSample,
  options: FieldLayerOptions = {},
): void {
  const arrows = computeFieldArrows(
    wind,
    camera,
    viewport,
    t,
    scratch,
    options.grid ?? DEFAULT_FIELD_GRID,
    options.scale ?? DEFAULT_FIELD_SCALE,
  );

  canvas.strokeStyle = options.color ?? DEFAULT_FIELD_COLOR;
  canvas.lineWidth = options.lineWidth ?? DEFAULT_FIELD_LINE_WIDTH;
  for (const arrow of arrows) {
    if (arrow.dx === 0 && arrow.dy === 0) continue;
    drawArrow(canvas, arrow.originX, arrow.originY, arrow.dx, arrow.dy);
  }
}
