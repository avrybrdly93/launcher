/**
 * Orthographic 3-view (P4.26, blueprint §Phase 4 note: "Phase 4 establishes
 * 3D state, forces, Coriolis, and orthographic multi-view. Beyond:
 * perspective Three.js scene...") -- xy/xz/yz projections of a 3D
 * trajectory, each its own independent `Camera2D` instance rather than a
 * new 3D-camera type: an orthographic projection onto a coordinate plane
 * *is* exactly a 2D camera over the two channels that plane keeps, per
 * `spatial-projectile-model.ts`'s `SPATIAL_CHANNELS` `[x, y, z, vx, vy,
 * vz]` convention. Reuses `auto-fit-camera.ts`/`hover-picking.ts` verbatim
 * per view rather than reimplementing bounds-fitting or picking for 3D.
 */

import type { Trajectory } from "@ballista/solverkit";
import type { Camera2DState, ScreenPoint, Viewport } from "./camera2d.js";
import {
  followBoundsIfAutoFitting,
  fitToView,
  type AutoFitOptions,
  type Bounds,
  type CameraViewState,
  computeBounds,
} from "./auto-fit-camera.js";
import { DEFAULT_MAX_PICK_DISTANCE_PX, pickNearestTrajectoryPoint } from "./hover-picking.js";

/** One of the three orthographic projections P4.26 requires "before any perspective work". */
export type ViewPlane = "xy" | "xz" | "yz";

export const VIEW_PLANES: readonly ViewPlane[] = ["xy", "xz", "yz"];

/**
 * Channel indices for each view's two displayed axes, per
 * `spatial-projectile-model.ts`'s `SPATIAL_CHANNELS` `[x, y, z, vx, vy,
 * vz]` convention (`x=0, y=1, z=2`) -- the single source every function
 * below reads from, so the three views can never disagree about which
 * channel is which.
 */
export const VIEW_PLANE_CHANNELS: Readonly<Record<ViewPlane, readonly [number, number]>> = {
  xy: [0, 1],
  xz: [0, 2],
  yz: [1, 2],
};

/** Axis labels for each view, in the same `[a, b]` order as {@link VIEW_PLANE_CHANNELS}. */
export const VIEW_PLANE_LABELS: Readonly<Record<ViewPlane, readonly [string, string]>> = {
  xy: ["x", "y"],
  xz: ["x", "z"],
  yz: ["y", "z"],
};

/** `trajectory`'s two channels displayed by `plane` -- throws if either is absent (a 2D-model trajectory has no z/vz channel to view xz/yz with). */
export function channelsForPlane(
  trajectory: Trajectory,
  plane: ViewPlane,
): { readonly a: Float64Array; readonly b: Float64Array } {
  const [aIndex, bIndex] = VIEW_PLANE_CHANNELS[plane];
  const a = trajectory.channels[aIndex];
  const b = trajectory.channels[bIndex];
  if (!a || !b) {
    throw new Error(
      `channelsForPlane: trajectory has no channel ${aIndex}/${bIndex} for the "${plane}" view`,
    );
  }
  return { a, b };
}

/** Bounds of `trajectory` projected onto `plane` (reuses `auto-fit-camera.ts#computeBounds` -- already channel-agnostic). */
export function boundsForPlane(trajectory: Trajectory, plane: ViewPlane): Bounds {
  const { a, b } = channelsForPlane(trajectory, plane);
  return computeBounds(a, b);
}

/** One `CameraViewState` per {@link ViewPlane}, keyed by plane -- each view pans/zooms/auto-fits fully independently of the other two. */
export type ThreeViewState = Readonly<Record<ViewPlane, CameraViewState>>;

/**
 * Initial three-view state: every plane auto-fit to `trajectory`'s own
 * projection onto it, independently. All three read from the same
 * `trajectory` (this task's "trajectory consistent across views" criterion)
 * -- they only ever differ in which two of its three spatial channels are
 * on screen, never in which rows exist.
 */
export function initThreeView(
  trajectory: Trajectory,
  viewport: Viewport,
  options?: AutoFitOptions,
): ThreeViewState {
  const state: Partial<Record<ViewPlane, CameraViewState>> = {};
  for (const plane of VIEW_PLANES) {
    state[plane] = fitToView(boundsForPlane(trajectory, plane), viewport, options);
  }
  return state as ThreeViewState;
}

/**
 * Re-fits every still-auto-fitting view to `trajectory`'s current bounds
 * (e.g. a new run published) -- a view the user has panned/zoomed is left
 * alone until reset, same rule `auto-fit-camera.ts#followBoundsIfAutoFitting`
 * already applies per view, just applied to all three independently.
 */
export function followThreeViewBounds(
  state: ThreeViewState,
  trajectory: Trajectory,
  viewport: Viewport,
  options?: AutoFitOptions,
): ThreeViewState {
  const next: Partial<Record<ViewPlane, CameraViewState>> = {};
  for (const plane of VIEW_PLANES) {
    next[plane] = followBoundsIfAutoFitting(
      state[plane],
      boundsForPlane(trajectory, plane),
      viewport,
      options,
    );
  }
  return next as ThreeViewState;
}

/** Installs a user pan/zoom on exactly one view, leaving the other two views' camera/auto-fit state untouched -- each view's pan/zoom is independent of the others. */
export function setViewCamera(
  state: ThreeViewState,
  plane: ViewPlane,
  camera: Camera2DState,
): ThreeViewState {
  return { ...state, [plane]: { camera, autoFit: false } };
}

/**
 * Picks the nearest trajectory row to `cursor` within `plane`'s own
 * projection and camera -- "picking works per-view" (this task's validation
 * criterion). Delegates to `hover-picking.ts#pickNearestTrajectoryPoint`
 * with `plane`'s channel pair rather than a second picking implementation,
 * so every view inherits that function's screen-space/anisotropic-zoom
 * correctness (P3.17) for free.
 */
export function pickInView(
  state: ThreeViewState,
  plane: ViewPlane,
  viewport: Viewport,
  trajectory: Trajectory,
  cursor: ScreenPoint,
  maxDistancePx: number = DEFAULT_MAX_PICK_DISTANCE_PX,
): number | null {
  return pickNearestTrajectoryPoint(
    state[plane].camera,
    viewport,
    trajectory,
    cursor,
    maxDistancePx,
    VIEW_PLANE_CHANNELS[plane],
  );
}
