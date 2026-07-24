import { atom, type ReadableAtom } from "nanostores";
import type { Trajectory } from "@ballista/solverkit";

/**
 * `compareStore` (§5.4: "list of pinned trajectories (method-comparison
 * mode)", mutability "append/remove"; P3.25). Mirrors `result-store.ts`'s
 * shape (a single frozen state atom, mutated only through named methods) so
 * the same "immutable after publish" guarantee `Trajectory` itself carries
 * (recorders return frozen `subarray` views) extends to the pinned list: a
 * pinned entry's `trajectory` can never be swapped out from under a caller
 * holding a reference to it.
 *
 * Color assignment is a fixed 8-hue categorical palette (never a generated
 * hue, per the platform's data-visualization convention: identity is
 * assigned in a fixed order, not cycled or re-derived from list length).
 * Slots are tracked independently of array position so an entry's color
 * never changes for as long as it stays pinned -- "color follows the
 * entity, never its rank" -- even when an earlier pin is removed and later
 * ones shift down in `pinned`. Concurrently pinned trajectories are capped
 * at the palette's size; a caller wanting more must unpin something first.
 */
export const COMPARE_PALETTE: readonly string[] = Object.freeze([
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
]);

export interface PinnedTrajectory {
  readonly id: string;
  readonly trajectory: Trajectory;
  /** The stepper id this trajectory was solved with (e.g. `"explicit-euler"`), for the legend label and method-comparison bookkeeping. */
  readonly stepperId: string;
  /** Defaults to `stepperId` when not given explicitly. */
  readonly label: string;
  readonly color: string;
}

export interface CompareStoreState {
  readonly pinned: readonly PinnedTrajectory[];
}

/** One legend row: swatch color + label, in pin order. */
export interface CompareLegendEntry {
  readonly id: string;
  readonly label: string;
  readonly color: string;
}

export interface CompareStore {
  readonly store: ReadableAtom<CompareStoreState>;
  getState(): CompareStoreState;
  /**
   * Appends a new pinned entry, assigning it the lowest-numbered palette
   * slot not currently held by another pinned entry. Throws once every
   * slot is in use (`COMPARE_PALETTE.length` concurrently pinned
   * trajectories) rather than silently reusing or cycling a color, since a
   * generated/duplicate hue would make two distinct pinned methods
   * indistinguishable in the overlay and legend.
   */
  pin(trajectory: Trajectory, stepperId: string, label?: string): PinnedTrajectory;
  /** Removes the pinned entry with this id (a no-op if it's already gone) and frees its color slot for reuse by a future pin. */
  unpin(id: string): void;
  /** Removes every pinned entry and frees all color slots. */
  clear(): void;
}

const EMPTY_STATE: CompareStoreState = Object.freeze({ pinned: Object.freeze([]) });

export function createCompareStore(): CompareStore {
  const store = atom<CompareStoreState>(EMPTY_STATE);
  let nextId = 0;
  // Slot index -> pinned entry id currently holding it (absent = free).
  const slotOwner = new Map<number, string>();

  function freeSlot(): number {
    for (let slot = 0; slot < COMPARE_PALETTE.length; slot++) {
      if (!slotOwner.has(slot)) return slot;
    }
    throw new Error(
      `Cannot pin more than ${COMPARE_PALETTE.length} trajectories at once (categorical palette exhausted); unpin one first.`,
    );
  }

  return {
    store,
    getState: () => store.get(),

    pin(trajectory, stepperId, label) {
      const slot = freeSlot();
      const id = `pin-${nextId++}`;
      slotOwner.set(slot, id);

      const entry: PinnedTrajectory = Object.freeze({
        id,
        trajectory,
        stepperId,
        label: label ?? stepperId,
        color: COMPARE_PALETTE[slot]!,
      });

      store.set(Object.freeze({ pinned: Object.freeze([...store.get().pinned, entry]) }));
      return entry;
    },

    unpin(id) {
      for (const [slot, ownerId] of slotOwner) {
        if (ownerId === id) {
          slotOwner.delete(slot);
          break;
        }
      }
      store.set(
        Object.freeze({ pinned: Object.freeze(store.get().pinned.filter((p) => p.id !== id)) }),
      );
    },

    clear() {
      slotOwner.clear();
      store.set(EMPTY_STATE);
    },
  };
}

/** Legend rows for `state.pinned`, in pin order -- what a legend component renders directly. */
export function compareLegend(state: CompareStoreState): readonly CompareLegendEntry[] {
  return state.pinned.map(({ id, label, color }) => ({ id, label, color }));
}
