/**
 * Anisotropic auto-fit (§6.1: "Auto-fit computes bounds from trajectory
 * extrema with padding; user pan/zoom disables auto-fit until reset") built
 * on {@link fitCameraToBounds} + {@link Camera2DState} (P3.06).
 */

import type { Camera2DState, Viewport } from "./camera2d.js";

/** Axis-aligned world-space bounding box. */
export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Bounding box of parallel x/y channel arrays (e.g. `trajectory.channels[0]`/`[1]`). Throws on empty input -- there is no sane bounds for zero points. */
export function computeBounds(xs: ArrayLike<number>, ys: ArrayLike<number>): Bounds {
  if (xs.length === 0) throw new Error("computeBounds: xs/ys must be non-empty");

  let minX = xs[0]!;
  let maxX = minX;
  let minY = ys[0]!;
  let maxY = minY;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

export interface AutoFitOptions {
  /** Fraction of each axis's span added as margin on *each* side. Default 0.1 (10%). */
  readonly paddingFraction?: number;
  /**
   * Floor on the padded span considered for each axis, world units. Guards
   * a degenerate axis (e.g. a dead-straight vertical drop has zero x
   * variation) from producing an infinite/absurd scale. Default 1.
   */
  readonly minSpan?: number;
}

const DEFAULT_PADDING_FRACTION = 0.1;
const DEFAULT_MIN_SPAN = 1;

/**
 * A `Camera2DState` that renders `bounds` centered in `viewport` with
 * `paddingFraction` margin on each side, scaling x and y independently
 * (anisotropic -- a range-vs-height trajectory keeps the full range visible
 * without wasting vertical resolution, or vice versa).
 */
export function fitCameraToBounds(
  bounds: Bounds,
  viewport: Viewport,
  options: AutoFitOptions = {},
): Camera2DState {
  const paddingFraction = options.paddingFraction ?? DEFAULT_PADDING_FRACTION;
  const minSpan = options.minSpan ?? DEFAULT_MIN_SPAN;

  const spanX = Math.max((bounds.maxX - bounds.minX) * (1 + 2 * paddingFraction), minSpan);
  const spanY = Math.max((bounds.maxY - bounds.minY) * (1 + 2 * paddingFraction), minSpan);

  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    scaleX: viewport.width / spanX,
    scaleY: viewport.height / spanY,
  };
}

/** Camera view state: the current camera, plus whether it's still auto-fitting (vs. a user having taken over via pan/zoom). */
export interface CameraViewState {
  readonly camera: Camera2DState;
  readonly autoFit: boolean;
}

/** Initial/reset view: fits `bounds` and (re-)enables auto-fit. Also what the "reset" button calls. */
export function fitToView(
  bounds: Bounds,
  viewport: Viewport,
  options: AutoFitOptions = {},
): CameraViewState {
  return { camera: fitCameraToBounds(bounds, viewport, options), autoFit: true };
}

/** User pan/zoom: install `camera` verbatim and disable auto-fit (§6.1: "user pan/zoom disables auto-fit until reset"). */
export function applyManualCamera(camera: Camera2DState): CameraViewState {
  return { camera, autoFit: false };
}

/**
 * Call when `bounds`/`viewport` may have changed (e.g. a new trajectory was
 * published, or the canvas resized). Re-fits only while `state.autoFit` is
 * still true; once the user has panned/zoomed, this is a no-op until
 * {@link fitToView} (the reset button) re-enables it.
 */
export function followBoundsIfAutoFitting(
  state: CameraViewState,
  bounds: Bounds,
  viewport: Viewport,
  options: AutoFitOptions = {},
): CameraViewState {
  return state.autoFit ? fitToView(bounds, viewport, options) : state;
}
