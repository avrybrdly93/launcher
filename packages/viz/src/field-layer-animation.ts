/**
 * Throttled tick clock for the wind {@link FieldLayer} animation (§6.2:
 * "Time-varying winds animate the field at reduced tick rate (10 Hz) to
 * avoid distraction."; P4.19).
 *
 * This is a *display-clock* concern only, and deliberately knows nothing
 * about `@ballista/engine`/`@ballista/solverkit`: it quantizes a
 * caller-supplied "display time" (seconds -- e.g. the playback clock's
 * `playbackTime`, P3.13, or a wall-clock timer for a live/unpaused scene)
 * down to the most recent 10 Hz tick boundary, so a caller resamples/
 * redraws `field-layer.ts`'s arrows (`sampleFieldArrows` + `drawFieldLayer`)
 * only when that quantized boundary actually advances -- not on every
 * animation frame, which for a 60 Hz `requestAnimationFrame` driver (§6.1)
 * would otherwise resample the wind model (and re-stroke ~24x16 arrows) six
 * times more often than the blueprint calls for.
 *
 * This module never reads or calls anything from the physics pipeline: it
 * has no reference to a `WindModel`, `Environment`, `Model`, or `Stepper`,
 * and the quantized time it produces is only ever fed back into
 * `sampleFieldArrows` (a `@ballista/viz`-local, purely-visual sample) --
 * never into `integrate()`'s own time-stepping, which keeps sampling
 * `WindModel.sample(t, ...)` at its own physically exact `t` regardless of
 * whatever tick rate (if any) a scene is animating the field overlay at.
 * `field-layer-animation.test.ts`'s determinism-guard test asserts this
 * explicitly: running a scenario with a time-varying wind through
 * `integrate()` produces a bit-identical SHA-256 trajectory hash whether or
 * not (and at whatever rate) a {@link FieldAnimationTicker} is driven
 * alongside it.
 *
 * Mirrors `static-layer-cache.ts`'s dirty-flag pattern -- redraw only when a
 * cheap-to-compare key changes -- but quantizes a continuous time value
 * into discrete ticks instead of comparing a camera/viewport/data-revision
 * key.
 */

/** §6.2's "reduced tick rate (10 Hz)". */
export const DEFAULT_FIELD_ANIMATION_TICK_HZ = 10;

/**
 * Quantizes `displayTimeSeconds` down to the most recent tick boundary at
 * `tickHz` (default {@link DEFAULT_FIELD_ANIMATION_TICK_HZ}) -- e.g. at the
 * default 10 Hz, every time in `[0.3, 0.4)` maps to exactly `0.3`. Floors
 * rather than rounds so the sampled field always reflects a moment that has
 * already elapsed, never one still in the future (consistent with a fixed-
 * tick clock: you don't see the *next* tick's state early).
 *
 * Non-finite or non-positive `tickHz`, and any `displayTimeSeconds <= 0`
 * (including `NaN`/`-Infinity`), quantize to `0` -- there is no valid
 * negative or fractional-before-zero tick.
 */
export function quantizeFieldAnimationTime(
  displayTimeSeconds: number,
  tickHz: number = DEFAULT_FIELD_ANIMATION_TICK_HZ,
): number {
  if (!(tickHz > 0) || !(displayTimeSeconds > 0)) return 0;
  return Math.floor(displayTimeSeconds * tickHz) / tickHz;
}

/** One {@link FieldAnimationTicker.tick} result. */
export interface FieldAnimationTick {
  /** The quantized display time (seconds) to resample the wind field at. */
  readonly time: number;
  /**
   * `true` exactly when `time` differs from the previous call's `time`
   * (always `true` on the first call) -- the caller's cue to actually call
   * `sampleFieldArrows`/`drawFieldLayer` again this frame. `false` means the
   * field hasn't reached its next 10 Hz tick yet: redraw the previously
   * sampled arrows unchanged (or skip the layer's draw call entirely, if
   * nothing else on screen needs a repaint).
   */
  readonly changed: boolean;
}

/**
 * Stateful throttle: call {@link FieldAnimationTicker.tick} once per
 * animation frame with the scene's current display time, and only
 * resample/redraw the field layer when the result's `changed` is `true`.
 * `tickCount` is the running number of `changed: true` results, exposed the
 * same way `StaticLayerCache.redrawCount` is (`static-layer-cache.ts`) --
 * for tests and any future telemetry, not for driving behavior itself.
 */
export interface FieldAnimationTicker {
  tick(displayTimeSeconds: number): FieldAnimationTick;
  readonly tickCount: number;
}

/**
 * Builds a {@link FieldAnimationTicker} throttling to `tickHz` (default
 * {@link DEFAULT_FIELD_ANIMATION_TICK_HZ}). Each instance owns its own
 * "last tick" state, so independent scenes (or a scene's on/off toggle,
 * P4.19's own validation scenario) never share a throttle -- exactly
 * `createStaticLayerCache`'s per-instance dirty-flag discipline
 * (`static-layer-cache.ts`), applied to time instead of a geometry key.
 */
export function createFieldAnimationTicker(
  tickHz: number = DEFAULT_FIELD_ANIMATION_TICK_HZ,
): FieldAnimationTicker {
  let lastTime: number | undefined;
  let tickCount = 0;

  return {
    tick(displayTimeSeconds: number): FieldAnimationTick {
      const time = quantizeFieldAnimationTime(displayTimeSeconds, tickHz);
      const changed = lastTime === undefined || time !== lastTime;
      if (changed) {
        lastTime = time;
        tickCount++;
      }
      return { time, changed };
    },
    get tickCount(): number {
      return tickCount;
    },
  };
}
