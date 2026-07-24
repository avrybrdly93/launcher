import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS, SchemaValidationError, type ScenarioSpec } from "@ballista/engine";
import {
  createScenarioKeyValueStoragePersistence,
  exportScenarioToJson,
  importScenarioFromJson,
  NO_SCENARIO_PERSISTENCE,
} from "./scenario-persistence.js";
import { createScenarioStore } from "./scenario-store.js";
import type { KeyValueStorage } from "./ui-store.js";

function memoryStorage(): KeyValueStorage {
  const backing = new Map<string, string>();
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => void backing.set(key, value),
  };
}

describe("exportScenarioToJson / importScenarioFromJson (P3.31 validation criterion)", () => {
  it("round-trips every preset scenario bit-equal (export -> import)", () => {
    for (const spec of PRESET_SCENARIOS) {
      const json = exportScenarioToJson(spec);
      const roundTripped = importScenarioFromJson(json);
      expect(roundTripped).toEqual(spec);
    }
  });

  it("produces plain JSON text, not some non-portable serialization", () => {
    const spec = PRESET_SCENARIOS[0]!;
    const json = exportScenarioToJson(spec);
    expect(typeof json).toBe("string");
    expect(JSON.parse(json)).toEqual(spec);
  });

  it("rejects malformed JSON", () => {
    expect(() => importScenarioFromJson("{not json")).toThrow(SyntaxError);
  });

  it("rejects a structurally invalid scenario with a useful (schema-identifying) error", () => {
    const invalid = { ...PRESET_SCENARIOS[0]!, schemaVersion: 999 };
    expect(() => importScenarioFromJson(JSON.stringify(invalid))).toThrow(SchemaValidationError);
  });
});

describe("createScenarioKeyValueStoragePersistence", () => {
  it("returns null when nothing has been saved yet", () => {
    const persistence = createScenarioKeyValueStoragePersistence(memoryStorage());
    expect(persistence.load()).toBeNull();
  });

  it("save then load round-trips the exact scenario", () => {
    const backing = memoryStorage();
    const persistence = createScenarioKeyValueStoragePersistence(backing);
    const spec = PRESET_SCENARIOS[1]!;

    persistence.save(spec);

    expect(persistence.load()).toEqual(spec);
  });

  it("a fresh persistence instance sharing the same storage sees an already-saved scenario", () => {
    const backing = memoryStorage();
    const spec = PRESET_SCENARIOS[2]!;
    createScenarioKeyValueStoragePersistence(backing).save(spec);

    const loaded = createScenarioKeyValueStoragePersistence(backing).load();
    expect(loaded).toEqual(spec);
  });

  it("falls back to null (not a throw) when the stored payload is corrupt JSON", () => {
    const backing = memoryStorage();
    backing.setItem("ballista:scenario", "{not json");
    const persistence = createScenarioKeyValueStoragePersistence(backing);
    expect(persistence.load()).toBeNull();
  });

  it("falls back to null when the stored payload fails schema validation", () => {
    const backing = memoryStorage();
    backing.setItem(
      "ballista:scenario",
      JSON.stringify({ ...PRESET_SCENARIOS[0]!, schemaVersion: 999 }),
    );
    const persistence = createScenarioKeyValueStoragePersistence(backing);
    expect(persistence.load()).toBeNull();
  });

  it("uses distinct storage keys for independent scenarios (custom key parameter)", () => {
    const backing = memoryStorage();
    const a = createScenarioKeyValueStoragePersistence(backing, "slot-a");
    const b = createScenarioKeyValueStoragePersistence(backing, "slot-b");

    a.save(PRESET_SCENARIOS[0]!);
    b.save(PRESET_SCENARIOS[1]!);

    expect(a.load()).toEqual(PRESET_SCENARIOS[0]);
    expect(b.load()).toEqual(PRESET_SCENARIOS[1]);
  });
});

describe("createScenarioStore persistence integration", () => {
  it("with NO_SCENARIO_PERSISTENCE (the default), nothing is restored across instances", () => {
    const [a, b] = PRESET_SCENARIOS as [ScenarioSpec, ScenarioSpec];
    const store1 = createScenarioStore(a, PRESET_SCENARIOS, NO_SCENARIO_PERSISTENCE);
    store1.commit(b);

    const store2 = createScenarioStore(a, PRESET_SCENARIOS, NO_SCENARIO_PERSISTENCE);
    expect(store2.getState().committed).toBe(a);
  });

  it("commit persists, and a fresh store sharing storage restores the committed scenario as its initial draft/committed", () => {
    const backing = memoryStorage();
    const persistence = createScenarioKeyValueStoragePersistence(backing);
    const [a, b] = PRESET_SCENARIOS as [ScenarioSpec, ScenarioSpec];

    const store1 = createScenarioStore(a, PRESET_SCENARIOS, persistence);
    expect(store1.getState().committed).toBe(a);
    store1.commit(b);

    const store2 = createScenarioStore(
      a,
      PRESET_SCENARIOS,
      createScenarioKeyValueStoragePersistence(backing),
    );
    expect(store2.getState().committed).toEqual(b);
    expect(store2.getState().draft).toEqual(b);
  });

  it("setDraft (input-rate mutation) does not persist -- only commit does", () => {
    const backing = memoryStorage();
    const persistence = createScenarioKeyValueStoragePersistence(backing);
    const [a, b] = PRESET_SCENARIOS as [ScenarioSpec, ScenarioSpec];

    const store1 = createScenarioStore(a, PRESET_SCENARIOS, persistence);
    store1.setDraft(b);

    const store2 = createScenarioStore(
      a,
      PRESET_SCENARIOS,
      createScenarioKeyValueStoragePersistence(backing),
    );
    // Nothing was ever committed, so nothing was ever saved -- store2 falls
    // back to its own `initial` argument, not store1's uncommitted draft.
    expect(store2.getState().committed).toBe(a);
  });
});
