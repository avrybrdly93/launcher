/**
 * `ProjectileLayer` (§6.1 WorldLayer; §5.4 "Playback is derived state ...
 * `playbackTime` maps to trajectory state via dense output; scrubbing is
 * pure lookup. ... The Recorder retains interpolation coefficients
 * precisely for this"; P3.12).
 *
 * The live solve's own dense-output interpolant (`Stepper.interpolant`,
 * §4.9) only exists for the duration of `integrate()` -- by the time a
 * `Trajectory` reaches Viz it's just the recorded columnar rows (`t`,
 * `channels`), no interpolation coefficients attached. But
 * `planarProjectileModel`'s state is `[x, y, vx, vy]` (see
 * `planar-projectile-model.ts`) -- velocity *is* `dx/dt`, `dy/dt` -- so the
 * recorded rows already carry everything cubic Hermite interpolation
 * (§4.9, P2.31's `hermiteInterpolant`) needs for the position channels:
 * `sampleProjectilePosition` reuses that exact function between the two
 * recorded rows bracketing `playbackTime`. For any fixed-step method (every
 * v1 stepper except DOPRI5 -- see `hermite-dense-output.ts`), this
 * reproduces the live solve's own dense output to floating-point
 * precision, rather than approximating it after the fact from scratch.
 */

import { hermiteInterpolant, type Trajectory } from "@ballista/solverkit";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { worldToScreen } from "./camera2d.js";

/** Column indices `planarProjectileModel` assigns its `[x, y, vx, vy]` state -- shared with `trajectory-layer.ts`'s `channels[0]/[1]` position convention. */
const X_CHANNEL = 0;
const Y_CHANNEL = 1;
const VX_CHANNEL = 2;
const VY_CHANNEL = 3;

/**
 * Index `i` such that `t[i] <= playbackTime <= t[i + 1]` via binary search
 * over the monotonically increasing recorded times, clamped to
 * `[0, t.length - 2]` -- a `playbackTime` outside the recorded span brackets
 * against the nearest edge interval rather than throwing (see
 * `sampleProjectilePosition`, which clamps `theta` itself so this holds at
 * the edge sample instead of extrapolating past it), since a playback clock
 * can start at or briefly round past the trajectory's own endpoints.
 * `t.length < 2` always returns 0 (nothing to bracket between).
 */
export function bracketStepIndex(t: ArrayLike<number>, playbackTime: number): number {
  const n = t.length;
  if (n < 2) return 0;
  if (playbackTime <= t[0]!) return 0;
  if (playbackTime >= t[n - 1]!) return n - 2;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= playbackTime) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Preallocated scratch {@link hermiteInterpolant} needs -- reused across frames so sampling the marker's position never allocates (§6.5). */
export interface ProjectileSampleScratch {
  readonly y0: Float64Array;
  readonly f0: Float64Array;
  readonly y1: Float64Array;
  readonly f1: Float64Array;
}

/** Allocates a {@link ProjectileSampleScratch} once (e.g. alongside the layer's other per-mount state); pass the same instance to every `sampleProjectilePosition`/`drawProjectileLayer` call. */
export function createProjectileSampleScratch(): ProjectileSampleScratch {
  return {
    y0: new Float64Array(2),
    f0: new Float64Array(2),
    y1: new Float64Array(2),
    f1: new Float64Array(2),
  };
}

/**
 * World-space `[x, y]` position at `playbackTime`, cubic-Hermite-
 * interpolated (§4.9) between the two recorded rows bracketing it, using
 * `trajectory`'s `x`/`y` channels as the Hermite basis's endpoint values
 * and its `vx`/`vy` channels as their derivatives. Writes into `out`
 * (length >= 2); allocates nothing beyond `scratch`/`out` (both owned by
 * the caller).
 */
export function sampleProjectilePosition(
  trajectory: Trajectory,
  playbackTime: number,
  scratch: ProjectileSampleScratch,
  out: Float64Array,
): void {
  const { t, channels } = trajectory;
  const i = bracketStepIndex(t, playbackTime);
  const t0 = t[i]!;
  const t1 = t[i + 1] ?? t0;
  const h = t1 - t0;

  const xs = channels[X_CHANNEL]!;
  const ys = channels[Y_CHANNEL]!;

  if (h === 0) {
    out[0] = xs[i]!;
    out[1] = ys[i]!;
    return;
  }

  const vxs = channels[VX_CHANNEL]!;
  const vys = channels[VY_CHANNEL]!;
  const j = i + 1;

  scratch.y0[0] = xs[i]!;
  scratch.y0[1] = ys[i]!;
  scratch.f0[0] = vxs[i]!;
  scratch.f0[1] = vys[i]!;
  scratch.y1[0] = xs[j]!;
  scratch.y1[1] = ys[j]!;
  scratch.f1[0] = vxs[j]!;
  scratch.f1[1] = vys[j]!;

  // Clamped to [0, 1] rather than passed through raw: a `playbackTime`
  // outside the recorded span (see `bracketStepIndex`) would otherwise
  // *extrapolate* the cubic arbitrarily far past its bracketing sample
  // instead of holding at it.
  const rawTheta = (playbackTime - t0) / h;
  const theta = rawTheta < 0 ? 0 : rawTheta > 1 ? 1 : rawTheta;
  hermiteInterpolant(theta, scratch.y0, scratch.f0, scratch.y1, scratch.f1, h, out);
}

/** The subset of `CanvasRenderingContext2D` `drawProjectileLayer` needs. */
export interface ProjectileLayerCanvas {
  fillStyle: string;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
}

export interface ProjectileLayerOptions {
  readonly color?: string;
  readonly radiusPx?: number;
}

const DEFAULT_COLOR = "#d6482b";
const DEFAULT_RADIUS_PX = 5;

/**
 * Draws a filled circular marker at `trajectory`'s interpolated position at
 * `playbackTime` (§6.1 ProjectileLayer). `scratch`/`worldOut` are supplied
 * by the caller so repeated per-frame calls (the common case -- playback
 * advancing) allocate nothing.
 */
export function drawProjectileLayer(
  ctx: ProjectileLayerCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  trajectory: Trajectory,
  playbackTime: number,
  scratch: ProjectileSampleScratch,
  worldOut: Float64Array,
  options: ProjectileLayerOptions = {},
): void {
  sampleProjectilePosition(trajectory, playbackTime, scratch, worldOut);
  const screen = worldToScreen(camera, viewport, { x: worldOut[0]!, y: worldOut[1]! });

  ctx.fillStyle = options.color ?? DEFAULT_COLOR;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, options.radiusPx ?? DEFAULT_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();
}
