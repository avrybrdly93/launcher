/**
 * Hover picking (§6.1: "World↔screen transforms are pure functions used by
 * both rendering and picking ... hover-to-inspect a trajectory point shows
 * full state tooltip"; P3.17).
 *
 * `pickNearestTrajectoryPoint` measures distance in *screen* space (via the
 * same `worldToScreen` rendering itself uses, `camera2d.ts`), not world
 * space -- essential under `Camera2D`'s anisotropic scaling (§6.1), where a
 * point a hundred world-units away horizontally can sit only a few pixels
 * from the cursor while one a tenth of a world-unit away vertically sits
 * far off screen. This is also this task's own validation criterion
 * ("picked index correct under zoom"): re-picking after a `zoomAtScreenPoint`
 * call must still resolve to the same trajectory row the cursor is
 * visually nearest to, which only holds if picking transforms every
 * candidate through the *current* camera rather than comparing raw world
 * coordinates.
 *
 * `trajectoryPointTooltip` builds the "full state tooltip" from nothing but
 * the recorded columnar `Trajectory` plus the model's declared
 * `ChannelMeta` (name/unit) -- Viz "consumes only this plus recorded
 * channel data" (schema.ts) rather than recomputing physics, unlike
 * `hud-readout.ts`/`force-glyphs.ts`, which need a live `Model`/`EvalContext`
 * for genuinely derived quantities (E, Re, S, Π) that aren't themselves
 * recorded channels.
 */

import type { ChannelMeta } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { worldToScreen } from "./camera2d.js";

/** Column indices shared with `projectile-layer.ts`/`trajectory-layer.ts`'s `[x, y, ...]` convention -- the default `channels` pair below, for the single-view 2D callers that predate P4.26's multi-view picking. */
const X_CHANNEL = 0;
const Y_CHANNEL = 1;

/** Picks nothing further than this many screen pixels from the cursor (§6.1 "hover-to-inspect"; a distant row shouldn't hijack an unrelated hover). */
export const DEFAULT_MAX_PICK_DISTANCE_PX = 20;

/**
 * Index of the recorded row whose screen position (under `camera`/
 * `viewport`) is nearest `cursor`, or `null` if every row is farther than
 * `maxDistancePx` (default {@link DEFAULT_MAX_PICK_DISTANCE_PX}) or the
 * trajectory has no rows. Ties favor the earlier index (first row wins a
 * dead-even tie, `<` not `<=` below).
 *
 * `channels` selects which two of `trajectory`'s channels are treated as
 * this pick's world x/y (default `[0, 1]`, this module's original 2D-only
 * pair) -- P4.26's orthographic 3-view reuses this same function per view
 * (`orthographic-views.ts#pickInView`) by passing e.g. `[0, 2]` for the xz
 * plane, rather than a second picking implementation.
 */
export function pickNearestTrajectoryPoint(
  camera: Camera2DState,
  viewport: Viewport,
  trajectory: Trajectory,
  cursor: { readonly x: number; readonly y: number },
  maxDistancePx: number = DEFAULT_MAX_PICK_DISTANCE_PX,
  channels: readonly [number, number] = [X_CHANNEL, Y_CHANNEL],
): number | null {
  const [aChannel, bChannel] = channels;
  const xs = trajectory.channels[aChannel];
  const ys = trajectory.channels[bChannel];
  if (!xs || !ys || trajectory.nSteps === 0) return null;

  let bestIndex = -1;
  let bestDistanceSq = Infinity;

  for (let i = 0; i < trajectory.nSteps; i++) {
    const screen = worldToScreen(camera, viewport, { x: xs[i]!, y: ys[i]! });
    const dx = screen.x - cursor.x;
    const dy = screen.y - cursor.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = i;
    }
  }

  const maxDistanceSq = maxDistancePx * maxDistancePx;
  return bestDistanceSq <= maxDistanceSq ? bestIndex : null;
}

/** One channel's labeled value at a picked row -- the "full state" a tooltip lists. */
export interface TooltipChannelValue {
  readonly name: string;
  readonly unit: string;
  readonly value: number;
}

/** The full-state tooltip content for one picked trajectory row (§6.1). */
export interface TrajectoryPointTooltip {
  readonly t: number;
  readonly channels: readonly TooltipChannelValue[];
}

/**
 * Builds the full-state tooltip for `trajectory`'s row `index`: its
 * recorded time plus every channel's labeled value there, in `channelMeta`
 * order (the same order/names/units the `Model` that produced `trajectory`
 * declared). Reads straight from the recorded columnar data -- no physics
 * recomputation.
 */
export function trajectoryPointTooltip(
  trajectory: Trajectory,
  channelMeta: readonly ChannelMeta[],
  index: number,
): TrajectoryPointTooltip {
  return {
    t: trajectory.t[index]!,
    channels: channelMeta.map((meta, i) => ({
      name: meta.name,
      unit: meta.unit,
      value: trajectory.channels[i]![index]!,
    })),
  };
}
