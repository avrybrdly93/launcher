/**
 * Orthographic 3-view (xy, xz, yz) over a 3D trajectory (P4.26). Blueprint
 * §6.4 gates any real 3D/perspective rendering (Three.js) to Phase 7+; this
 * task is explicitly "before any perspective work" -- three independent
 * axis-aligned 2D projections, each rendered and picked with the existing
 * `Camera2D`/auto-fit/hover-picking machinery, not a new rendering engine.
 *
 * Each view is just an `[x, y, ...]`-shaped pair of channel indices into the
 * same recorded `Trajectory` (P4.23's dim-6 spatial model convention,
 * `spatial-projectile-model.ts`: channels `[x, y, z, vx, vy, vz]`), so
 * `buildTrajectoryPath` (`trajectory-layer.ts`) already renders any of the
 * three planes unmodified by passing it that plane's channel arrays -- the
 * only two things this module needs to add are (a) per-plane bounds/camera
 * fitting and (b) per-plane picking, generalizing `pickNearestByChannels`
 * (`hover-picking.ts`) instead of its `pickNearestTrajectoryPoint` xy-only
 * wrapper.
 *
 * "trajectory consistent across views" (this task's validation criterion)
 * holds by construction: every view reads from the same `trajectory.channels`
 * array and a pick always resolves to a row *index*, so a point picked in
 * one view identifies the exact same recorded row -- and therefore the same
 * physical state -- in the other two.
 */

import type { Trajectory } from "@ballista/solverkit";
import type { AutoFitOptions, Bounds } from "./auto-fit-camera.js";
import { computeBounds, fitCameraToBounds } from "./auto-fit-camera.js";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { pickNearestByChannels } from "./hover-picking.js";

/** Channel indices for the dim-6 spatial model's `[x, y, z, ...]` convention (`spatial-projectile-model.ts`). */
const X_CHANNEL = 0;
const Y_CHANNEL = 1;
const Z_CHANNEL = 2;

/** One of the three axis-aligned orthographic projections this task adds. */
export type ViewPlane = "xy" | "xz" | "yz";

/** All three view planes, in the order the blueprint lists them. */
export const VIEW_PLANES: readonly ViewPlane[] = ["xy", "xz", "yz"];

/** Which trajectory channel a plane maps to screen-x and to screen-y. */
export interface PlaneChannels {
  readonly horizontal: number;
  readonly vertical: number;
}

const VIEW_PLANE_CHANNELS: Readonly<Record<ViewPlane, PlaneChannels>> = {
  xy: { horizontal: X_CHANNEL, vertical: Y_CHANNEL },
  xz: { horizontal: X_CHANNEL, vertical: Z_CHANNEL },
  yz: { horizontal: Y_CHANNEL, vertical: Z_CHANNEL },
};

/** The channel-index pair `plane` projects to screen-x/screen-y. */
export function planeChannels(plane: ViewPlane): PlaneChannels {
  return VIEW_PLANE_CHANNELS[plane];
}

/**
 * World-space bounds of `trajectory` projected onto `plane`.
 * @throws if `trajectory` has fewer than `plane`'s channel indices, or has
 *   zero recorded rows (same as `computeBounds` -- there is no sane bounds
 *   for zero points).
 */
export function computeBoundsForPlane(trajectory: Trajectory, plane: ViewPlane): Bounds {
  const { horizontal, vertical } = planeChannels(plane);
  const hs = trajectory.channels[horizontal];
  const vs = trajectory.channels[vertical];
  if (!hs || !vs) {
    throw new Error(
      `computeBoundsForPlane: trajectory has no channel ${horizontal}/${vertical} for plane "${plane}"`,
    );
  }
  return computeBounds(hs, vs);
}

/** One `Camera2DState` per {@link ViewPlane}, each independently auto-fit. */
export type ThreeViewCameras = Readonly<Record<ViewPlane, Camera2DState>>;

/**
 * Auto-fit cameras for all three orthographic views of `trajectory`, each
 * fit independently to that plane's own bounds (a trajectory can be wide in
 * xy and narrow in xz, so a shared camera would waste resolution on one
 * view or clip the other). `viewport` is reused for all three, matching a
 * layout of three equal-size panels; pass a different `Viewport` per plane
 * (call {@link computeBoundsForPlane} + `fitCameraToBounds` directly) if
 * panels differ in size.
 */
export function fitThreeViewCameras(
  trajectory: Trajectory,
  viewport: Viewport,
  options?: AutoFitOptions,
): ThreeViewCameras {
  return {
    xy: fitCameraToBounds(computeBoundsForPlane(trajectory, "xy"), viewport, options),
    xz: fitCameraToBounds(computeBoundsForPlane(trajectory, "xz"), viewport, options),
    yz: fitCameraToBounds(computeBoundsForPlane(trajectory, "yz"), viewport, options),
  };
}

/**
 * Index of the recorded row nearest `cursor` in `plane`'s projection, under
 * `camera`/`viewport` -- the per-view counterpart of
 * `pickNearestTrajectoryPoint` (`hover-picking.ts`), which is fixed to the
 * xy plane. `null` under the same conditions `pickNearestByChannels`
 * returns `null` (nothing within `maxDistancePx`, or an empty trajectory).
 */
export function pickNearestTrajectoryPointInPlane(
  camera: Camera2DState,
  viewport: Viewport,
  trajectory: Trajectory,
  plane: ViewPlane,
  cursor: { readonly x: number; readonly y: number },
  maxDistancePx?: number,
): number | null {
  const { horizontal, vertical } = planeChannels(plane);
  return pickNearestByChannels(
    camera,
    viewport,
    trajectory,
    horizontal,
    vertical,
    cursor,
    maxDistancePx,
  );
}
