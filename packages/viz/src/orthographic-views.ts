/**
 * Orthographic 3-view camera (§10.3: "Phase 4 establishes 3D state, forces,
 * Coriolis, and orthographic multi-view" -- before any Three.js/perspective
 * work, which §6.4 defers to Phase 7+; P4.26). Each view is nothing more
 * than an independent `Camera2DState` fed a different pair of
 * `spatial-projectile-model.ts`'s six channels -- `Camera2D`,
 * `fitCameraToBounds`, and `pickNearestTrajectoryPointOnChannels` are
 * already channel-agnostic (P3.06/P3.07/P4.26), so 3D visualization here is
 * "pick which two channels", not new rendering machinery.
 *
 * View convention (matches `spatial-projectile-model.ts#SPATIAL_CHANNELS`
 * and `vec3.ts`'s "x = downrange, y = up, z = lateral/out-of-plane" axes):
 *   - xy: downrange vs. altitude -- the same view a 2D (z≡0) trajectory
 *     already renders, unchanged.
 *   - xz: downrange vs. lateral drift, seen from directly above (plan view).
 *   - yz: altitude vs. lateral drift, seen from directly behind/ahead.
 * A 2D trajectory's xz/yz views degenerate to a flat `z=0` line rather than
 * erroring -- a natural sanity check, not a special case.
 */

import type { Trajectory } from "@ballista/solverkit";
import type { Camera2DState, Viewport } from "./camera2d.js";
import {
  type AutoFitOptions,
  type Bounds,
  computeBounds,
  fitCameraToBounds,
} from "./auto-fit-camera.js";
import {
  DEFAULT_MAX_PICK_DISTANCE_PX,
  pickNearestTrajectoryPointOnChannels,
} from "./hover-picking.js";

/** One of the three axis-aligned orthographic views this task establishes. */
export type OrthographicViewId = "xy" | "xz" | "yz";

/** A view's identity plus the trajectory channel pair it slices (`[xChannel, yChannel]` -- the pair fed to every `Camera2D`/picking function for this view). */
export interface OrthographicViewDef {
  readonly id: OrthographicViewId;
  readonly label: string;
  readonly xChannel: number;
  readonly yChannel: number;
}

/** The 3 canonical views, in a stable display order. */
export const ORTHOGRAPHIC_VIEWS: readonly OrthographicViewDef[] = [
  { id: "xy", label: "Downrange vs. altitude", xChannel: 0, yChannel: 1 },
  { id: "xz", label: "Downrange vs. lateral (plan view)", xChannel: 0, yChannel: 2 },
  { id: "yz", label: "Altitude vs. lateral (rear view)", xChannel: 1, yChannel: 2 },
];

/** Looks up one view's definition by id. Throws on an id outside {@link ORTHOGRAPHIC_VIEWS} -- there is no sane fallback view. */
export function orthographicViewDef(viewId: OrthographicViewId): OrthographicViewDef {
  const def = ORTHOGRAPHIC_VIEWS.find((v) => v.id === viewId);
  if (!def) throw new Error(`orthographic-views: unknown view id "${viewId}"`);
  return def;
}

/** Pulls `view`'s two channel arrays out of `trajectory`. Throws if the trajectory doesn't record that many channels (e.g. a 2D model has no channel 2/`z`). */
export function trajectoryViewChannels(
  trajectory: Trajectory,
  viewId: OrthographicViewId,
): { readonly xs: Float64Array; readonly ys: Float64Array } {
  const { xChannel, yChannel } = orthographicViewDef(viewId);
  const xs = trajectory.channels[xChannel];
  const ys = trajectory.channels[yChannel];
  if (!xs || !ys) {
    throw new Error(
      `orthographic-views: trajectory has ${trajectory.channels.length} channel(s), view "${viewId}" needs channels ${xChannel}/${yChannel}`,
    );
  }
  return { xs, ys };
}

/** {@link computeBounds} restricted to `view`'s channel pair. */
export function boundsForView(trajectory: Trajectory, viewId: OrthographicViewId): Bounds {
  const { xs, ys } = trajectoryViewChannels(trajectory, viewId);
  return computeBounds(xs, ys);
}

/**
 * An auto-fit `Camera2DState` for `view` alone, independent of every other
 * view's camera -- each of the 3 panes pans/zooms on its own (§10.3
 * "orthographic multi-view" is 3 independent views, not one shared camera).
 */
export function fitCameraToView(
  trajectory: Trajectory,
  viewId: OrthographicViewId,
  viewport: Viewport,
  options: AutoFitOptions = {},
): Camera2DState {
  return fitCameraToBounds(boundsForView(trajectory, viewId), viewport, options);
}

/**
 * {@link pickNearestTrajectoryPointOnChannels} restricted to `view`'s
 * channel pair -- each view's picking is fully independent (its own camera,
 * own channel pair), so hovering in one pane never depends on another
 * pane's zoom/pan state (P4.26 validation: "picking works per-view").
 */
export function pickNearestPointInView(
  trajectory: Trajectory,
  viewId: OrthographicViewId,
  camera: Camera2DState,
  viewport: Viewport,
  cursor: { readonly x: number; readonly y: number },
  maxDistancePx: number = DEFAULT_MAX_PICK_DISTANCE_PX,
): number | null {
  const { xChannel, yChannel } = orthographicViewDef(viewId);
  return pickNearestTrajectoryPointOnChannels(
    camera,
    viewport,
    trajectory,
    cursor,
    xChannel,
    yChannel,
    maxDistancePx,
  );
}
