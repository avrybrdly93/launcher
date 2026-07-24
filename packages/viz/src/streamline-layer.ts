/**
 * Streamline overlay (§6.1 FieldLayer: "wind vector field (grid arrows /
 * streamlines)"; §6.2 "optional streamlines by RK2 integration of the
 * *display* field (cheap, purely visual -- explicitly not the physics
 * path)"; P3.28).
 *
 * "Display field" RK2 is deliberately *not* `@ballista/solverkit`'s RK2
 * stepper (Heun's method integrating a dynamical state through *time*):
 * this traces a static direction field through *arc length* at one frozen
 * instant `t`, so each step advances by a fixed `stepLength` along the
 * field's local unit direction rather than by the wind's own (highly
 * variable) magnitude over a physical `dt`. That's what keeps a streamline
 * readable as a pure direction curve regardless of how wind speed varies
 * along it -- exactly the same reason `FieldLayer`'s arrows are
 * length-clamped rather than truly proportional at the high end
 * (`field-layer.ts`).
 *
 * Seeds reuse `field-layer.ts`'s screen-anchored grid layout
 * ({@link computeFieldGridScreenPoints}) at a sparser resolution than the
 * arrow grid -- one streamline per seed reads far better than one per
 * arrow would.
 */

import type { EnvSample, WindModel } from "@ballista/engine";
import type { Camera2DState, ScreenPoint, Viewport } from "./camera2d.js";
import { screenToWorld, worldToScreen } from "./camera2d.js";
import { computeFieldGridScreenPoints, type FieldGridConfig } from "./field-layer.js";

/** A world-space point, structurally compatible with `Camera2DState`'s `WorldPoint`. */
export interface WorldPointLike {
  readonly x: number;
  readonly y: number;
}

/** RK2 streamline-tracing configuration. */
export interface StreamlineConfig {
  /** Fixed arc-length advance per RK2 step, in world units (not physical time -- see module doc). */
  readonly stepLength: number;
  /** Trace stops after this many steps even if the field never goes calm. */
  readonly maxSteps: number;
  /** Screen-anchored seed grid (sparser than `FieldLayer`'s arrow grid). */
  readonly seedGrid: FieldGridConfig;
}

export const DEFAULT_STREAMLINE_CONFIG: StreamlineConfig = Object.freeze({
  stepLength: 2, // m
  maxSteps: 40,
  seedGrid: Object.freeze({ cols: 8, rows: 5, marginPx: 32 }),
});

/** Unit wind direction at `(x, y, t)`, plus the raw magnitude so a calm point (magnitude 0, no direction) is distinguishable from a genuine unit vector. */
function normalizedWindAt(
  wind: WindModel,
  t: number,
  x: number,
  y: number,
  scratch: EnvSample,
): { ux: number; uy: number; magnitude: number } {
  wind.sample(t, x, y, scratch);
  const magnitude = Math.hypot(scratch.wx, scratch.wy);
  if (magnitude === 0) return { ux: 0, uy: 0, magnitude: 0 };
  return { ux: scratch.wx / magnitude, uy: scratch.wy / magnitude, magnitude };
}

/**
 * Traces one streamline in world space from `seed` via explicit-midpoint
 * (RK2) integration of `wind`'s unit direction, frozen at time `t`:
 * `k1` = direction at the current point, `k2` = direction at the
 * half-step midpoint, then the full step advances along `k2` -- the
 * textbook RK2 stencil, applied to arc length instead of time. Stops
 * (returning however many points it reached) at `config.maxSteps` or as
 * soon as either sample lands exactly calm (`magnitude === 0`), since a
 * calm point has no direction to continue along. Always returns at least
 * the seed itself.
 */
export function traceStreamlineWorld(
  wind: WindModel,
  t: number,
  seed: WorldPointLike,
  scratch: EnvSample,
  config: StreamlineConfig = DEFAULT_STREAMLINE_CONFIG,
): WorldPointLike[] {
  const points: WorldPointLike[] = [{ x: seed.x, y: seed.y }];
  let x = seed.x;
  let y = seed.y;

  for (let i = 0; i < config.maxSteps; i++) {
    const k1 = normalizedWindAt(wind, t, x, y, scratch);
    if (k1.magnitude === 0) break;

    const midX = x + (config.stepLength / 2) * k1.ux;
    const midY = y + (config.stepLength / 2) * k1.uy;
    const k2 = normalizedWindAt(wind, t, midX, midY, scratch);
    if (k2.magnitude === 0) break;

    x += config.stepLength * k2.ux;
    y += config.stepLength * k2.uy;
    points.push({ x, y });
  }

  return points;
}

/**
 * One traced streamline per screen-anchored seed
 * ({@link computeFieldGridScreenPoints} at `config.seedGrid}), each
 * returned as a screen-space polyline ({@link traceStreamlineWorld}'s
 * world-space points mapped back through `worldToScreen`) ready for
 * {@link drawStreamlineLayer}. Mirrors `field-layer.ts`'s
 * `sampleFieldArrows`: seed positions stay fixed on screen as the camera
 * pans/zooms, only the world field they trace through changes.
 */
export function computeStreamlines(
  wind: WindModel,
  t: number,
  camera: Camera2DState,
  viewport: Viewport,
  scratch: EnvSample,
  config: StreamlineConfig = DEFAULT_STREAMLINE_CONFIG,
): ScreenPoint[][] {
  const seedsScreen = computeFieldGridScreenPoints(viewport, config.seedGrid);
  return seedsScreen.map((screenSeed) => {
    const worldSeed = screenToWorld(camera, viewport, screenSeed);
    const worldPoints = traceStreamlineWorld(wind, t, worldSeed, scratch, config);
    return worldPoints.map((p) => worldToScreen(camera, viewport, p));
  });
}

/** The subset of `CanvasRenderingContext2D` `drawStreamlineLayer` needs. */
export interface StreamlineLayerCanvas {
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

export interface StreamlineLayerOptions {
  /**
   * The "toggle" (P3.28's title): streamlines are opt-in (§6.2 "optional
   * streamlines"), unlike the always-on arrow grid, so this defaults to
   * `false` -- callers flip it on rather than the layer defaulting to
   * drawing something extra every frame.
   */
  readonly enabled?: boolean;
  readonly color?: string;
  readonly lineWidth?: number;
  readonly alpha?: number;
}

const DEFAULT_STREAMLINE_COLOR = "#1c7ed6";
const DEFAULT_STREAMLINE_LINE_WIDTH = 1;
const DEFAULT_STREAMLINE_ALPHA = 0.35;

/**
 * Draws every streamline as a polyline, or nothing at all when
 * `options.enabled` is falsy (default) -- the toggle lives entirely in
 * this call, so a caller flips it without touching `FieldLayer`'s arrow
 * rendering. Restores `globalAlpha` to what it was before this call
 * (mirrors `ghost-layer.ts`/`field-layer.ts`'s "never leak style onto the
 * next layer" discipline, §6.1 frame-loop). A streamline with fewer than
 * two points (traced zero steps, e.g. seeded exactly on a calm point)
 * draws nothing.
 */
export function drawStreamlineLayer(
  canvas: StreamlineLayerCanvas,
  streamlines: readonly (readonly ScreenPoint[])[],
  options: StreamlineLayerOptions = {},
): void {
  if (!options.enabled) return;

  const previousAlpha = canvas.globalAlpha;
  canvas.strokeStyle = options.color ?? DEFAULT_STREAMLINE_COLOR;
  canvas.lineWidth = options.lineWidth ?? DEFAULT_STREAMLINE_LINE_WIDTH;
  canvas.globalAlpha = options.alpha ?? DEFAULT_STREAMLINE_ALPHA;

  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;

    canvas.beginPath();
    canvas.moveTo(streamline[0]!.x, streamline[0]!.y);
    for (let i = 1; i < streamline.length; i++) {
      canvas.lineTo(streamline[i]!.x, streamline[i]!.y);
    }
    canvas.stroke();
  }

  canvas.globalAlpha = previousAlpha;
}
