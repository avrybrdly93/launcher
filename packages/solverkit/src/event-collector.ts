import type { EventRoot } from "./event-root-localization.js";
import type { Sink, SolveReport } from "./types.js";

/**
 * Collects every localized *non-terminal* event crossing of a solve (§4.9,
 * §5.4 playback "scrub bar with event ticks", P3.13) -- e.g. apex (`v_y`
 * falling through zero). `integrate` calls {@link EventCollector.event} once
 * per crossing, in the order they occur; terminal events (e.g. ground
 * impact) are never dispatched here -- they already end the trajectory
 * normally and appear as its final recorded row (see `ResultStoreState`).
 *
 * Mirrors {@link TrajectoryRecorder}'s freeze-on-finish pattern: `events`
 * only becomes readable once the solve concludes, so a caller can never
 * observe a partially-collected list.
 */
export class EventCollector implements Sink {
  readonly id = "event-collector";

  private readonly collected: EventRoot[] = [];
  private frozen: readonly EventRoot[] | undefined;

  /** @inheritDoc */
  event(root: EventRoot): void {
    this.collected.push(root);
  }

  /** @inheritDoc */
  finish(_report: SolveReport): void {
    this.frozen = Object.freeze([...this.collected]);
  }

  /** Every localized non-terminal event crossing, in occurrence order; only valid after `finish` has run. */
  get events(): readonly EventRoot[] {
    if (!this.frozen) {
      throw new Error("EventCollector.events read before finish()");
    }
    return this.frozen;
  }
}
