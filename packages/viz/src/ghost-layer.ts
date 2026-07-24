/**
 * `GhostLayer` (§6.1 WorldLayer: "GhostLayer faded comparison / analytic
 * overlay"; P3.26). The geometry is identical to `TrajectoryLayer`'s --
 * {@link buildTrajectoryPath} (P3.09) traces the same world-space `xs`/`ys`
 * through the same camera transform -- a ghost overlay differs only in
 * *style*: faded (`globalAlpha`) and dashed, so an analytic reference (or
 * any other comparison trajectory) reads as a backdrop rather than a second
 * solid trajectory competing with the live one. Numeric coincidence with a
 * DOPRI5 solve at rtol 1e-6 (this task's other validation half) is
 * `packages/validation`'s concern, not this layer's -- `viz` isn't allowed
 * to import the dev-only `validation` package (`.dependency-cruiser.cjs`),
 * and this module has no opinion on where its `xs`/`ys` came from.
 */

import type { Camera2DState, Viewport } from "./camera2d.js";
import { buildTrajectoryPath, type TrajectoryLayerCanvas } from "./trajectory-layer.js";

/** `TrajectoryLayerCanvas` plus what "ghosting" needs beyond a plain stroke: `globalAlpha` (fade) and `setLineDash` (dashed stroke). */
export interface GhostLayerCanvas extends TrajectoryLayerCanvas {
  globalAlpha: number;
  setLineDash(segments: readonly number[]): void;
}

export interface GhostLayerOptions {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly alpha?: number;
  readonly dash?: readonly number[];
}

const DEFAULT_GHOST_COLOR = "#868e96";
const DEFAULT_GHOST_LINE_WIDTH = 1.5;
const DEFAULT_GHOST_ALPHA = 0.45;
const DEFAULT_GHOST_DASH: readonly number[] = [6, 4];

/**
 * Sets `ctx`'s stroke style/width/alpha/dash for a ghost stroke, defaulting
 * anything `options` doesn't specify. Split out from {@link drawGhostLayer}
 * so it's unit-testable against a plain recording mock -- unlike the
 * `Path2D` construction the drawing half needs, this part has no
 * browser-only dependency.
 */
export function applyGhostStyle(ctx: GhostLayerCanvas, options: GhostLayerOptions = {}): void {
  ctx.strokeStyle = options.color ?? DEFAULT_GHOST_COLOR;
  ctx.lineWidth = options.lineWidth ?? DEFAULT_GHOST_LINE_WIDTH;
  ctx.globalAlpha = options.alpha ?? DEFAULT_GHOST_ALPHA;
  ctx.setLineDash(options.dash ?? DEFAULT_GHOST_DASH);
}

/**
 * Draws `xs`/`ys` as a ghosted (faded + dashed) polyline via
 * {@link buildTrajectoryPath}/{@link applyGhostStyle}, then restores
 * `globalAlpha`/line dash to what they were before this call -- `ctx` is a
 * persistent 2D context reused every frame (§6.1 frame-loop discipline), so
 * a layer must never leak its style onto whatever draws after it in the
 * same frame. Browser-only (`Path2D`); mirrors `drawTrajectoryLayer`'s own
 * untested-directly status (`Path2D` doesn't exist under Node -- see
 * `trajectory-layer.ts`'s module doc).
 */
export function drawGhostLayer(
  ctx: GhostLayerCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  options: GhostLayerOptions = {},
): void {
  const path = new Path2D();
  buildTrajectoryPath(path, camera, viewport, xs, ys);

  const previousAlpha = ctx.globalAlpha;
  applyGhostStyle(ctx, options);
  ctx.stroke(path);
  ctx.globalAlpha = previousAlpha;
  ctx.setLineDash([]);
}
