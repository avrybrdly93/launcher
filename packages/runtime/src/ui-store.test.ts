import { describe, expect, it } from "vitest";
import {
  createKeyValueStoragePersistence,
  createUiStore,
  NO_PERSISTENCE,
  type KeyValueStorage,
} from "./ui-store.js";

function memoryStorage(): KeyValueStorage {
  const backing = new Map<string, string>();
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => void backing.set(key, value),
  };
}

describe("uiStore", () => {
  it("starts with default panel layout, no selected exhibits, SI units", () => {
    const { getState } = createUiStore();
    expect(getState()).toEqual({ panelLayout: {}, selectedExhibits: [], unitsDisplay: "SI" });
  });

  it("setPanelCollapsed sets one panel's state without disturbing others or the previous snapshot", () => {
    const { getState, setPanelCollapsed } = createUiStore();
    setPanelCollapsed("solver", true);
    const before = getState();
    setPanelCollapsed("forces", false);
    const after = getState();

    expect(after.panelLayout).toEqual({ solver: true, forces: false });
    expect(before.panelLayout).toEqual({ solver: true });
  });

  it("setSelectedExhibits and setUnitsDisplay replace their own field", () => {
    const { getState, setSelectedExhibits, setUnitsDisplay } = createUiStore();
    setSelectedExhibits(["work-precision", "phase-plot"]);
    setUnitsDisplay("imperial");
    expect(getState().selectedExhibits).toEqual(["work-precision", "phase-plot"]);
    expect(getState().unitsDisplay).toBe("imperial");
  });

  it("with NO_PERSISTENCE (the default), state does not survive a new store instance", () => {
    const store1 = createUiStore(NO_PERSISTENCE);
    store1.setUnitsDisplay("imperial");
    const store2 = createUiStore(NO_PERSISTENCE);
    expect(store2.getState().unitsDisplay).toBe("SI");
  });

  it("with a KeyValueStorage-backed persistence, state survives a new store instance reading the same backing store", () => {
    const backing = memoryStorage();
    const persistence = createKeyValueStoragePersistence(backing);

    const store1 = createUiStore(persistence);
    store1.setUnitsDisplay("imperial");
    store1.setPanelCollapsed("solver", true);

    const store2 = createUiStore(createKeyValueStoragePersistence(backing));
    expect(store2.getState().unitsDisplay).toBe("imperial");
    expect(store2.getState().panelLayout).toEqual({ solver: true });
  });

  it("a corrupt persisted payload is ignored (falls back to defaults) rather than throwing", () => {
    const backing = memoryStorage();
    backing.setItem("ballista:ui-store", "{not json");
    const store = createUiStore(createKeyValueStoragePersistence(backing));
    expect(store.getState()).toEqual({ panelLayout: {}, selectedExhibits: [], unitsDisplay: "SI" });
  });

  it("every published snapshot (and its nested collections) is frozen", () => {
    const { getState, setPanelCollapsed, setSelectedExhibits } = createUiStore();
    setPanelCollapsed("solver", true);
    setSelectedExhibits(["a"]);
    const state = getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.panelLayout)).toBe(true);
    expect(Object.isFrozen(state.selectedExhibits)).toBe(true);
    expect(() => {
      // @ts-expect-error -- intentionally violating readonly to prove runtime immutability
      state.unitsDisplay = "imperial";
    }).toThrow(TypeError);
  });
});
