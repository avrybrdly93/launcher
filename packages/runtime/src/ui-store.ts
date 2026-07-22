import { atom, type ReadableAtom } from "nanostores";

export type UnitsDisplay = "SI" | "imperial";

/** Panel layout: dock/drawer group id -> collapsed state (§6.3, collapsible control groups). */
export type PanelLayout = Readonly<Record<string, boolean>>;

/** UI preferences (§5.4): mutable, persisted to localStorage across sessions. */
export interface UiStoreState {
  readonly panelLayout: PanelLayout;
  readonly selectedExhibits: readonly string[];
  readonly unitsDisplay: UnitsDisplay;
}

export interface UiStore {
  readonly store: ReadableAtom<UiStoreState>;
  getState(): UiStoreState;
  setPanelCollapsed(panelId: string, collapsed: boolean): void;
  setSelectedExhibits(exhibits: readonly string[]): void;
  setUnitsDisplay(units: UnitsDisplay): void;
}

const DEFAULT_STATE: UiStoreState = Object.freeze({
  panelLayout: Object.freeze({}),
  selectedExhibits: Object.freeze([]),
  unitsDisplay: "SI",
});

function freeze(state: UiStoreState): UiStoreState {
  return Object.freeze({
    ...state,
    panelLayout: Object.freeze({ ...state.panelLayout }),
    selectedExhibits: Object.freeze([...state.selectedExhibits]),
  });
}

/** Structural subset of `window.localStorage` -- kept local so this package needs no DOM lib (§2.1 L2 stays portable). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UiStorePersistence {
  load(): UiStoreState | null;
  save(state: UiStoreState): void;
}

/** No persistence: state resets to defaults every session. The default for `createUiStore`. */
export const NO_PERSISTENCE: UiStorePersistence = { load: () => null, save: () => {} };

/** Wire a concrete `localStorage`-like object in from the app layer (which has DOM lib) to persist across sessions. */
export function createKeyValueStoragePersistence(
  storage: KeyValueStorage,
  key = "ballista:ui-store",
): UiStorePersistence {
  return {
    load() {
      const raw = storage.getItem(key);
      if (!raw) return null;
      try {
        return freeze({ ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<UiStoreState>) });
      } catch {
        return null;
      }
    },
    save(state) {
      storage.setItem(key, JSON.stringify(state));
    },
  };
}

export function createUiStore(persistence: UiStorePersistence = NO_PERSISTENCE): UiStore {
  const store = atom<UiStoreState>(persistence.load() ?? DEFAULT_STATE);
  const commit = (next: UiStoreState) => {
    store.set(next);
    persistence.save(next);
  };

  return {
    store,
    getState: () => store.get(),
    setPanelCollapsed(panelId, collapsed) {
      const prev = store.get();
      commit(freeze({ ...prev, panelLayout: { ...prev.panelLayout, [panelId]: collapsed } }));
    },
    setSelectedExhibits(exhibits) {
      commit(freeze({ ...store.get(), selectedExhibits: exhibits }));
    },
    setUnitsDisplay(units) {
      commit(freeze({ ...store.get(), unitsDisplay: units }));
    },
  };
}
