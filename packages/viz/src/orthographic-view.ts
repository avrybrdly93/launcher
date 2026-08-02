/**
 * `OrthographicView` (P4.26: "3D camera: orthographic 3-view (xy, xz, yz)
 * before any perspective work"). A spatial (dim-6) trajectory's position is
 * recorded as three channels -- `[x, y, z, vx, vy, vz]`, x = downrange,
 * y = up, z = lateral/out-of-plane (`@ballista/engine`'s
 * `spatial-projectile-model.ts`, pinned in P4.23). Each orthographic view is
 * nothing more than a choice of *which two* of those three position channels
 * feed `Camera2D`/`TrajectoryLayer`/`hover-picking` as its 2D world x/y --
 * those modules stay untouched, they already take arbitrary channel arrays
 * (`trajectory-layer.ts`'s `buildTrajectoryPath`) or configurable channel
 * indices (`hover-picking.ts`'s `pickNearestTrajectoryPoint`). "3-view"
 * means picking one `OrthographicView` at a time, not compositing all three
 * simultaneously -- true perspective/multi-viewport compositing is later,
 * explicit future work (blueprint §Beyond Phase 4).
 */

export type OrthographicViewId = "xy" | "xz" | "yz";

export interface OrthographicView {
  readonly id: OrthographicViewId;
  /** Short UI label for a view picker. */
  readonly label: string;
  /** Index into a spatial trajectory's `channels` array plotted as screen-x. */
  readonly horizontalChannel: number;
  /** Index into a spatial trajectory's `channels` array plotted as screen-y (Camera2D's y-up world axis). */
  readonly verticalChannel: number;
  readonly horizontalAxisLabel: string;
  readonly verticalAxisLabel: string;
}

/** `SPATIAL_CHANNELS` position-channel indices (`@ballista/engine`'s `spatial-projectile-model.ts`). */
const X_CHANNEL = 0;
const Y_CHANNEL = 1;
const Z_CHANNEL = 2;

export const ORTHOGRAPHIC_VIEW_IDS: readonly OrthographicViewId[] = ["xy", "xz", "yz"];

/**
 * The three orthographic views, keyed by id. `xy` is the existing 2D side
 * view (downrange vs. height) unchanged from every pre-3D scenario; `xz` is
 * a top-down plan view (downrange vs. lateral); `yz` is a front/end
 * elevation looking back down the downrange axis (lateral vs. height) --
 * the natural view for reading sidespin/crosswind drift (P4.24/P4.25) that
 * `xy` alone cannot show.
 */
export const ORTHOGRAPHIC_VIEWS: Readonly<Record<OrthographicViewId, OrthographicView>> = {
  xy: {
    id: "xy",
    label: "Side (x–y)",
    horizontalChannel: X_CHANNEL,
    verticalChannel: Y_CHANNEL,
    horizontalAxisLabel: "downrange (m)",
    verticalAxisLabel: "height (m)",
  },
  xz: {
    id: "xz",
    label: "Top (x–z)",
    horizontalChannel: X_CHANNEL,
    verticalChannel: Z_CHANNEL,
    horizontalAxisLabel: "downrange (m)",
    verticalAxisLabel: "lateral (m)",
  },
  yz: {
    id: "yz",
    label: "Front (z–y)",
    horizontalChannel: Z_CHANNEL,
    verticalChannel: Y_CHANNEL,
    horizontalAxisLabel: "lateral (m)",
    verticalAxisLabel: "height (m)",
  },
};
