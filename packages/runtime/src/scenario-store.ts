import { atom, type ReadableAtom } from "nanostores";
import type { ScenarioSpec } from "@ballista/engine";
import { NO_SCENARIO_PERSISTENCE, type ScenarioPersistence } from "./scenario-persistence.js";

/**
 * Draft/committed split (§5.3): `draft` mutates at input rate (slider drags);
 * `committed` only ever changes atomically, via {@link ScenarioStore.commit},
 * which is what downstream re-integration reacts to.
 */
export interface ScenarioStoreState {
  readonly draft: ScenarioSpec;
  readonly committed: ScenarioSpec;
  readonly presets: readonly ScenarioSpec[];
}

export interface ScenarioStore {
  readonly store: ReadableAtom<ScenarioStoreState>;
  getState(): ScenarioStoreState;
  /** Replaces the draft only -- does not trigger re-integration (§5.3). */
  setDraft(next: ScenarioSpec): void;
  /** Atomically replaces both draft and committed -- this is the re-integration trigger (§5.3). */
  commit(spec: ScenarioSpec): void;
  setPresets(presets: readonly ScenarioSpec[]): void;
}

function freeze(state: ScenarioStoreState): ScenarioStoreState {
  return Object.freeze({ ...state, presets: Object.freeze([...state.presets]) });
}

/**
 * `persistence` (P3.31, default {@link NO_SCENARIO_PERSISTENCE}) restores a
 * previously-saved scenario as the initial draft/committed spec (taking
 * precedence over `initial` when present) and saves every `commit` back --
 * mirroring `ui-store.ts`'s `persistence`-parameter pattern exactly. `commit`
 * is the right save point (not `setDraft`, which fires at input rate): a
 * reloaded session should resume the last *committed* scenario, not an
 * in-flight slider drag.
 */
export function createScenarioStore(
  initial: ScenarioSpec,
  presets: readonly ScenarioSpec[] = [],
  persistence: ScenarioPersistence = NO_SCENARIO_PERSISTENCE,
): ScenarioStore {
  const restored = persistence.load() ?? initial;
  const store = atom<ScenarioStoreState>(freeze({ draft: restored, committed: restored, presets }));

  return {
    store,
    getState: () => store.get(),
    setDraft(next) {
      store.set(freeze({ ...store.get(), draft: next }));
    },
    commit(spec) {
      store.set(freeze({ ...store.get(), draft: spec, committed: spec }));
      persistence.save(spec);
    },
    setPresets(nextPresets) {
      store.set(freeze({ ...store.get(), presets: nextPresets }));
    },
  };
}
