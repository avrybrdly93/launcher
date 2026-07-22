/**
 * `TrajectoryLayer` (§6.1 WorldLayer, §6.2 "Trajectory polyline: rendered
 * from the columnar store via `Path2D`..."; P3.09). Screen-space RDP
 * decimation (§6.2) is a separate task (P3.10); this module just builds the
 * full-resolution polyline path from a trajectory's `x`/`y` channels through
 * the camera transform.
 *
 * `buildTrajectoryPath` is pure and takes a minimal path-builder interface
 * (mirrors `AxesLayerCanvas` in `axes-layer.ts`) rather than the concrete
 * DOM `Path2D`, so it's usable both against a real `Path2D` in the browser
 * and directly unit-tested in Node (`Path2D` doesn't exist there).
 */

import type { Camera2DState, Viewport } from "./camera2d.js";
import { worldToScreen } from "./camera2d.js";

/** The subset of `Path2D` (or an equivalent recording builder) `buildTrajectoryPath` needs. */
export interface PathBuilder {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

/**
 * Traces `xs`/`ys` (parallel columnar channel arrays, e.g.
 * `trajectory.channels[0]`/`[1]`) into `path` as a single polyline in
 * screen space, one `moveTo` for the first point and one `lineTo` per
 * subsequent point -- no decimation, no allocation beyond the caller's
 * `path`. A trajectory with fewer than 2 points draws nothing (a lone point
 * has no line to trace).
 */
export function buildTrajectoryPath(
  path: PathBuilder,
  camera: Camera2DState,
  viewport: Viewport,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
): void {
  if (xs.length < 2) return;

  const first = worldToScreen(camera, viewport, { x: xs[0]!, y: ys[0]! });
  path.moveTo(first.x, first.y);
  for (let i = 1; i < xs.length; i++) {
    const p = worldToScreen(camera, viewport, { x: xs[i]!, y: ys[i]! });
    path.lineTo(p.x, p.y);
  }
}

/** The subset of `CanvasRenderingContext2D` `drawTrajectoryLayer` needs. */
export interface TrajectoryLayerCanvas {
  strokeStyle: string;
  lineWidth: number;
  stroke(path: Path2D): void;
}

export interface TrajectoryLayerOptions {
  readonly color?: string;
  readonly lineWidth?: number;
}

const DEFAULT_COLOR = "#2b7fd6";
const DEFAULT_LINE_WIDTH = 1.5;

/**
 * Builds a real `Path2D` from `xs`/`ys` via {@link buildTrajectoryPath} and
 * strokes it. Browser-only (constructs `Path2D` directly) -- tests exercise
 * {@link buildTrajectoryPath} against a recording `PathBuilder` instead,
 * since `Path2D` isn't available under Node.
 */
export function drawTrajectoryLayer(
  ctx: TrajectoryLayerCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  options: TrajectoryLayerOptions = {},
): void {
  const path = new Path2D();
  buildTrajectoryPath(path, camera, viewport, xs, ys);
  ctx.strokeStyle = options.color ?? DEFAULT_COLOR;
  ctx.lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  ctx.stroke(path);
}
