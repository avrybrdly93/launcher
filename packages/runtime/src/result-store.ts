import { atom, type ReadableAtom } from "nanostores";
import type { EventRoot, SolveStats, Trajectory } from "@ballista/solverkit";

/**
 * Result of the last committed solve (§5.4): "immutable after publish".
 * There is deliberately no per-field setter -- {@link ResultStore.publish}
 * is the only mutator, so a partially-updated (trajectory from one solve,
 * stats from another) state can never be observed.
 *
 * `events` holds every localized *non-terminal* event crossing of the solve
 * (P3.13's `EventCollector` sink, §5.4 "scrub bar with event ticks"), e.g.
 * apex. Terminal events (e.g. ground impact) already end the trajectory
 * normally, so they show up as the trajectory's final row rather than here.
 */
export interface ResultStoreState {
  readonly trajectory: Trajectory | null;
  readonly stats: SolveStats | null;
  readonly events: readonly EventRoot[];
}

export interface ResultStore {
  readonly store: ReadableAtom<ResultStoreState>;
  getState(): ResultStoreState;
  publish(trajectory: Trajectory, stats: SolveStats, events?: readonly EventRoot[]): void;
  clear(): void;
}

const EMPTY_STATE: ResultStoreState = Object.freeze({
  trajectory: null,
  stats: null,
  events: Object.freeze([]),
});

export function createResultStore(): ResultStore {
  const store = atom<ResultStoreState>(EMPTY_STATE);

  return {
    store,
    getState: () => store.get(),
    publish(trajectory, stats, events = []) {
      store.set(Object.freeze({ trajectory, stats, events: Object.freeze([...events]) }));
    },
    clear() {
      store.set(EMPTY_STATE);
    },
  };
}
