/**
 * Playback scrub bar (§5.3/§5.4 "scrubbing is pure lookup"; P3.13). This
 * module is the pure, allocation-light domain layer a scrub-bar widget
 * draws/hit-tests against -- normalized-fraction <-> seconds mapping and
 * event-tick placement -- deliberately independent of any DOM/Canvas
 * concerns (no widget exists yet; `AnnotationLayer`, P3.16, will reuse
 * {@link computeEventTicks} for its own world-space markers).
 *
 * The task's validation criterion ("scrub to apex tick lands at v_y=0
 * state") is met by construction, not by tolerance: a tick's `t` is exactly
 * the {@link EventRoot.t} `SimulationSession.scrubToEvent` (runtime package)
 * was given, and `EventRoot.y` is the same root-localized state where
 * `g(t,y)` (here, `v_y`) is ~0 by definition of the apex event -- so any
 * caller that scrubs *to a tick* rather than to an approximate drag
 * position lands exactly on it. {@link snapToNearestEventTick} is what lets
 * a freehand drag/click land on a tick too, snapping to its exact time
 * whenever the raw scrub position falls within `toleranceSeconds` of it.
 */

import type { EventRoot } from "@ballista/solverkit";

/** One event tick's scrub-bar placement, derived from a solve's localized non-terminal events (P3.13, apex etc.). */
export interface EventTick {
  /** The event's name, e.g. `"apex"` (see `EventSpec.name`). */
  readonly label: string;
  /** Localized event time, in seconds -- identical to the underlying {@link EventRoot.t}. */
  readonly t: number;
  /** `t` normalized to `[0, 1]` of the trajectory's duration, for positioning a tick mark along the bar. */
  readonly fraction: number;
}

/** `t` (seconds) as a fraction of `[0, duration]`, clamped to `[0, 1]`. `duration <= 0` maps everything to `0` (nothing to scrub). */
export function timeToFraction(t: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const fraction = t / duration;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/** Inverse of {@link timeToFraction}: a `[0, 1]` fraction back to seconds, clamped to `[0, duration]`. `duration <= 0` always maps to `0`. */
export function fractionToTime(fraction: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return clamped * duration;
}

/**
 * Maps a solve's localized non-terminal events to scrub-bar ticks, sorted
 * by time. `duration <= 0` (no trajectory yet) yields no ticks -- there is
 * nothing to place them along.
 */
export function computeEventTicks(
  events: readonly EventRoot[],
  duration: number,
): readonly EventTick[] {
  if (!(duration > 0)) return [];

  return events
    .map((event) => ({
      label: event.event.name,
      t: event.t,
      fraction: timeToFraction(event.t, duration),
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Snaps a raw scrubbed time to the nearest tick within `toleranceSeconds`,
 * so a freehand drag/click that lands *near* (not exactly on) a tick still
 * resolves to that tick's exact time -- the mechanism behind "scrub to
 * apex tick lands at v_y=0 state" for pointer input, where a pixel-accurate
 * click on the *exact* event time is not realistic. Returns `t` unchanged
 * when no tick is within tolerance.
 */
export function snapToNearestEventTick(
  t: number,
  ticks: readonly EventTick[],
  toleranceSeconds: number,
): number {
  let nearest: EventTick | undefined;
  let nearestDistance = Infinity;

  for (const tick of ticks) {
    const distance = Math.abs(tick.t - t);
    if (distance < nearestDistance) {
      nearest = tick;
      nearestDistance = distance;
    }
  }

  if (nearest !== undefined && nearestDistance <= toleranceSeconds) {
    return nearest.t;
  }
  return t;
}
