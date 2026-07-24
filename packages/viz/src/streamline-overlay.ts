/**
 * Streamline overlay (§6.2: "optional streamlines by RK2 integration of the
 * *display* field (cheap, purely visual -- explicitly not the physics
 * path)"; P3.28). A streamline is a polyline traced through
 * {@link FieldLayer}'s same wind field ({@link WindSampleSource}), stepping
 * along the field's *normalized* direction at each point rather than
 * integrating the raw (unnormalized) vector -- a fixed screen-pixel arc
 * length per step keeps line density visually uniform regardless of how
 * fast or slow the wind happens to be at any given point, which is what a
 * flow-visualization streamline is for (unlike the physics solver, where
 * step size trades off against integration error).
 *
 * Tracing happens entirely in *screen* space: each step samples the world
 * point under the current screen position (`screenToWorld`), then converts
 * the sampled wind back to a screen-space unit direction via
 * `worldForceDirectionToScreen` -- the exact same transform
 * `field-layer.ts`'s arrows use, so a streamline's local tangent is
 * guaranteed consistent with the arrow drawn at that point (P3.28's
 * "streamlines tangent to arrows" validation criterion holds by
 * construction, not by coincidence of two independent implementations).
 *
 * The "display-only" qualifier matters: this never touches
 * `@ballista/solverkit`'s adaptive step-size machinery or the physics rhs --
 * it is textbook midpoint RK2 on the purely-visual ODE ds/dt = normalize(W),
 * arc-length parameterized, nothing more.
 */

import type { EnvSample } from "@ballista/engine";
import type { Camera2DState, ScreenPoint, Viewport } from "./camera2d.js";
import { screenToWorld } from "./camera2d.js";
import type { FieldLayerGridConfig, WindSampleSource } from "./field-layer.js";
import { fieldGridScreenPoints } from "./field-layer.js";
import { worldForceDirectionToScreen } from "./force-glyphs.js";

export interface StreamlineConfig {
  /** Arc length per RK2 step, in screen px -- controls both visual density and how tightly a curved field is tracked. */
  readonly stepPx: number;
  readonly maxSteps: number;
  /** Wind speeds at or below this (m/s) have no reliable direction to follow; tracing stops rather than dividing ~0/~0. */
  readonly minMagnitude: number;
}

export const DEFAULT_STREAMLINE_CONFIG: StreamlineConfig = Object.freeze({
  stepPx: 8,
  maxSteps: 60,
  minMagnitude: 1e-6,
});

/** Seed points, sparser than {@link DEFAULT_FIELD_GRID}'s arrow grid -- one streamline per seed would be visually cluttered at arrow density. */
export const DEFAULT_STREAMLINE_SEED_GRID: FieldLayerGridConfig = Object.freeze({
  cols: 6,
  rows: 4,
  marginPx: 32,
});

/** The field's screen-space unit direction and raw magnitude at `screenPoint`, or `null` where the wind is too weak to have a reliable direction (below `minMagnitude`). */
function screenUnitDirectionAt(
  wind: WindSampleSource,
  camera: Camera2DState,
  viewport: Viewport,
  t: number,
  scratch: EnvSample,
  screenPoint: ScreenPoint,
  minMagnitude: number,
): { ux: number; uy: number } | null {
  const world = screenToWorld(camera, viewport, screenPoint);
  wind.sample(t, world.x, world.y, scratch);
  if (Math.hypot(scratch.wx, scratch.wy) <= minMagnitude) return null;

  const { dx, dy } = worldForceDirectionToScreen(scratch.wx, scratch.wy);
  return { ux: dx, uy: dy };
}

/**
 * Traces one streamline from `origin` by midpoint RK2 on the normalized
 * field direction: each step samples the direction at the current point
 * (`k1`), takes a half-step to estimate a midpoint direction (`k2`), then
 * commits a full `stepPx` step along `k2` -- the standard RK2 accuracy
 * improvement over a naive forward-Euler walk, applied here to arc length
 * rather than time. Tracing stops early (returning fewer than `maxSteps + 1`
 * points) wherever the field vanishes below `config.minMagnitude`, since
 * there is nothing to march along.
 */
export function traceStreamline(
  wind: WindSampleSource,
  camera: Camera2DState,
  viewport: Viewport,
  t: number,
  scratch: EnvSample,
  origin: ScreenPoint,
  config: StreamlineConfig = DEFAULT_STREAMLINE_CONFIG,
): ScreenPoint[] {
  const points: ScreenPoint[] = [origin];
  let current = origin;

  for (let i = 0; i < config.maxSteps; i++) {
    const k1 = screenUnitDirectionAt(
      wind,
      camera,
      viewport,
      t,
      scratch,
      current,
      config.minMagnitude,
    );
    if (!k1) break;

    const midpoint: ScreenPoint = {
      x: current.x + (config.stepPx / 2) * k1.ux,
      y: current.y + (config.stepPx / 2) * k1.uy,
    };
    const k2 =
      screenUnitDirectionAt(wind, camera, viewport, t, scratch, midpoint, config.minMagnitude) ??
      k1;

    current = { x: current.x + config.stepPx * k2.ux, y: current.y + config.stepPx * k2.uy };
    points.push(current);
  }

  return points;
}

/**
 * Traces one streamline per seed point of `seedGrid` (reusing
 * {@link fieldGridScreenPoints}, same screen-anchored layout `FieldLayer`
 * uses for its arrows, just a coarser grid).
 */
export function computeStreamlines(
  wind: WindSampleSource,
  camera: Camera2DState,
  viewport: Viewport,
  t: number,
  scratch: EnvSample,
  seedGrid: FieldLayerGridConfig = DEFAULT_STREAMLINE_SEED_GRID,
  config: StreamlineConfig = DEFAULT_STREAMLINE_CONFIG,
): ScreenPoint[][] {
  return fieldGridScreenPoints(viewport, seedGrid).map((seed) =>
    traceStreamline(wind, camera, viewport, t, scratch, seed, config),
  );
}

/** The subset of `CanvasRenderingContext2D` `drawStreamlineOverlay` needs. */
export interface StreamlineCanvas {
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

export interface StreamlineOverlayOptions {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly alpha?: number;
}

const DEFAULT_STREAMLINE_COLOR = "#1c7ed6";
const DEFAULT_STREAMLINE_LINE_WIDTH = 1;
const DEFAULT_STREAMLINE_ALPHA = 0.5;

/**
 * The streamline overlay's toggle: `false` draws nothing at all (the caller
 * simply doesn't pay for tracing or drawing on a frame the overlay is off --
 * `FieldLayer`'s discrete arrows are the always-on view, this is the
 * optional layer on top of them, §6.1/§6.2). `drawStreamlineOverlay` itself
 * stays pure/stateless like every other layer here; a UI toggle is just a
 * boolean a caller threads into this parameter each frame.
 */
export function drawStreamlineOverlay(
  canvas: StreamlineCanvas,
  streamlines: readonly (readonly ScreenPoint[])[],
  enabled: boolean,
  options: StreamlineOverlayOptions = {},
): void {
  if (!enabled) return;

  const previousAlpha = canvas.globalAlpha;
  canvas.strokeStyle = options.color ?? DEFAULT_STREAMLINE_COLOR;
  canvas.lineWidth = options.lineWidth ?? DEFAULT_STREAMLINE_LINE_WIDTH;
  canvas.globalAlpha = options.alpha ?? DEFAULT_STREAMLINE_ALPHA;

  for (const line of streamlines) {
    if (line.length < 2) continue;
    canvas.beginPath();
    canvas.moveTo(line[0]!.x, line[0]!.y);
    for (let i = 1; i < line.length; i++) canvas.lineTo(line[i]!.x, line[i]!.y);
    canvas.stroke();
  }

  canvas.globalAlpha = previousAlpha;
}
