/**
 * `AxesLayer` (§6.1 HudLayer: "adaptive ticks (1-2-5 progression), units";
 * P3.08). Tick placement follows the standard "nice numbers" algorithm:
 * candidate step sizes are restricted to `{1, 2, 5} x 10^k` so labels are
 * always round decimal values, and the candidate closest to
 * `span / targetCount` is chosen. This keeps the rendered tick count close
 * to `targetCount` (bounded to roughly half..1.4x of it) regardless of the
 * axis's absolute scale, which is what makes it "adaptive" across zoom
 * levels spanning many decades -- unlike a fixed pixel-spacing rule, it
 * never degenerates to 0 or hundreds of ticks.
 *
 * `computeAxisTicks`/`formatTickValue` are pure and unit-tested directly;
 * `drawAxesLayer` is a thin, allocation-free (per §6.5) consumer of them
 * against a minimal Canvas2D-like surface, matching the pattern in
 * `canvas-bootstrap.ts` of depending on the smallest interface needed
 * rather than the full `CanvasRenderingContext2D`.
 */

import type { Camera2DState, Viewport } from "./camera2d.js";
import { screenToWorld, worldToScreen } from "./camera2d.js";

const DEFAULT_TARGET_TICK_COUNT = 6;

/**
 * The "nice" step between ticks for an axis spanning `[min, max]`, aiming
 * for roughly `targetCount` ticks. Restricted to the 1-2-5 progression
 * (times a power of ten) so every tick lands on a round decimal value.
 */
export function computeNiceStep(
  min: number,
  max: number,
  targetCount = DEFAULT_TARGET_TICK_COUNT,
): number {
  const span = max - min;
  if (!(span > 0) || !(targetCount > 0)) {
    throw new Error(
      `computeNiceStep: expected max > min and targetCount > 0, got [${min}, ${max}], ${targetCount}`,
    );
  }

  const rawStep = span / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;

  let niceNormalized: number;
  if (normalized <= 1.5) niceNormalized = 1;
  else if (normalized <= 3) niceNormalized = 2;
  else if (normalized <= 7) niceNormalized = 5;
  else niceNormalized = 10;

  return niceNormalized * magnitude;
}

/**
 * Tick positions covering `[min, max]` on the 1-2-5 progression, targeting
 * (not guaranteeing exactly, by nature of the progression) `targetCount`
 * ticks. Empirically holds to 4-8 ticks across at least 6 decades of span
 * (P3.08 validation criterion) -- see `axes-layer.test.ts`.
 */
export function computeAxisTicks(
  min: number,
  max: number,
  targetCount = DEFAULT_TARGET_TICK_COUNT,
): number[] {
  const step = computeNiceStep(min, max, targetCount);
  const start = Math.ceil(min / step) * step;
  // Guards fp accumulation (e.g. start + n*step landing a hair past `max`
  // from rounding) rather than dropping a legitimate last tick.
  const count = Math.floor((max - start) / step + 1e-9);
  // The step's own decimal precision -- used to clean up binary fp noise
  // like 0.30000000000000004 in each tick value (a plain `value/step`
  // rescale doesn't fix this, since the noise is in the *decimal*
  // representation of `value`, not a ratio to `step`).
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    const value = start + i * step;
    ticks.push(Number(value.toFixed(decimals)));
  }
  return ticks;
}

/**
 * Formats a tick's numeric label at a precision derived from `step` (so
 * `step=0.5` prints one decimal, `step=100` prints an integer, etc.),
 * optionally suffixed with a unit. `-0` is normalized to `0`.
 */
export function formatTickValue(value: number, step: number, unit?: string): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const rounded = Number(value.toFixed(Math.min(decimals, 20)));
  const text = Object.is(rounded, -0) ? "0" : rounded.toFixed(decimals);
  return unit ? `${text} ${unit}` : text;
}

/** World-space bounds currently visible in `viewport` under `camera` -- the exact inverse of the auto-fit bounds concept, derived from the camera instead of the data. */
export function visibleWorldBounds(
  camera: Camera2DState,
  viewport: Viewport,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const topLeft = screenToWorld(camera, viewport, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, viewport, { x: viewport.width, y: viewport.height });
  return { minX: topLeft.x, maxX: bottomRight.x, minY: bottomRight.y, maxY: topLeft.y };
}

/** The subset of `CanvasRenderingContext2D` `drawAxesLayer` needs. */
export interface AxesLayerCanvas {
  strokeStyle: string;
  lineWidth: number;
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

export interface AxesLayerOptions {
  readonly targetTickCount?: number;
  readonly xUnit?: string;
  readonly yUnit?: string;
  readonly gridColor?: string;
  readonly labelColor?: string;
  readonly font?: string;
}

const DEFAULT_OPTIONS: Required<Omit<AxesLayerOptions, "xUnit" | "yUnit">> = {
  targetTickCount: DEFAULT_TARGET_TICK_COUNT,
  gridColor: "rgba(128, 128, 128, 0.25)",
  labelColor: "rgba(64, 64, 64, 0.9)",
  font: "11px sans-serif",
};

/**
 * Draws grid lines at each adaptive tick and axis labels along the bottom
 * and left edges, for whatever world span `camera`/`viewport` currently
 * show. Ticks are recomputed from the camera every call rather than cached
 * -- cheap (a handful of arithmetic ops), unlike the trajectory geometry
 * §6.1 calls out for offscreen caching -- so panning/zooming never leaves
 * stale grid lines.
 */
export function drawAxesLayer(
  ctx: AxesLayerCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  options: AxesLayerOptions = {},
): void {
  const targetTickCount = options.targetTickCount ?? DEFAULT_OPTIONS.targetTickCount;
  const gridColor = options.gridColor ?? DEFAULT_OPTIONS.gridColor;
  const labelColor = options.labelColor ?? DEFAULT_OPTIONS.labelColor;
  const font = options.font ?? DEFAULT_OPTIONS.font;

  const bounds = visibleWorldBounds(camera, viewport);
  const xStep = computeNiceStep(bounds.minX, bounds.maxX, targetTickCount);
  const yStep = computeNiceStep(bounds.minY, bounds.maxY, targetTickCount);
  const xTicks = computeAxisTicks(bounds.minX, bounds.maxX, targetTickCount);
  const yTicks = computeAxisTicks(bounds.minY, bounds.maxY, targetTickCount);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const tick of xTicks) {
    const screen = worldToScreen(camera, viewport, { x: tick, y: 0 });
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, viewport.height);
  }
  for (const tick of yTicks) {
    const screen = worldToScreen(camera, viewport, { x: 0, y: tick });
    ctx.moveTo(0, screen.y);
    ctx.lineTo(viewport.width, screen.y);
  }
  ctx.stroke();

  ctx.fillStyle = labelColor;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tick of xTicks) {
    const screen = worldToScreen(camera, viewport, { x: tick, y: 0 });
    ctx.fillText(formatTickValue(tick, xStep, options.xUnit), screen.x, viewport.height - 14);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    const screen = worldToScreen(camera, viewport, { x: 0, y: tick });
    ctx.fillText(formatTickValue(tick, yStep, options.yUnit), 4, screen.y);
  }
}
