/**
 * Scenario save/load (§6.3 point 7: "save/load (localStorage + JSON file)")
 * -- P3.31. Two independent halves, both built on `@ballista/engine`'s
 * existing `ScenarioSpec` schema/migration machinery so a persisted or
 * exported scenario is validated exactly like any other scenario source:
 *
 * - **localStorage**: {@link createScenarioKeyValueStoragePersistence} mirrors
 *   `ui-store.ts`'s `KeyValueStorage`-backed persistence pattern exactly
 *   (reusing its `KeyValueStorage` interface), so this L2 package still
 *   needs no DOM lib -- the app layer wires a real `localStorage` in.
 * - **JSON file**: {@link exportScenarioToJson}/{@link importScenarioFromJson}
 *   are pure string functions (no `Blob`/`File`/download-trigger DOM APIs,
 *   which belong to the app/ui layer that actually has a document to hand
 *   a download to); serialize with `JSON.stringify` and deserialize via
 *   `migrateScenarioSpec` (not a raw schema parse) so an exported file from
 *   an older schema version still imports cleanly.
 *
 * Copy-URL sharing (deflate+base64url in the fragment) is P3.32, deliberately
 * out of scope here (§6.3 lists "save/load" and "copy-URL" as separate
 * bullets).
 */
import { migrateScenarioSpec, type ScenarioSpec } from "@ballista/engine";
import type { KeyValueStorage } from "./ui-store.js";

/** Serializes `spec` to a pretty-printed JSON string suitable for a downloadable `.json` file. */
export function exportScenarioToJson(spec: ScenarioSpec): string {
  return JSON.stringify(spec, null, 2);
}

/**
 * Parses and migrates `json` back into a `ScenarioSpec`. Throws (a
 * `SyntaxError` for malformed JSON, or `SchemaValidationError` for a
 * structurally invalid/unsupported-future-version payload) rather than
 * silently discarding a bad file -- callers (a file-import UI action) should
 * catch and surface the message.
 */
export function importScenarioFromJson(json: string): ScenarioSpec {
  return migrateScenarioSpec(JSON.parse(json));
}

export interface ScenarioPersistence {
  load(): ScenarioSpec | null;
  save(spec: ScenarioSpec): void;
}

/** No persistence: nothing is restored, nothing is written. The default for {@link createScenarioStore}. */
export const NO_SCENARIO_PERSISTENCE: ScenarioPersistence = { load: () => null, save: () => {} };

/**
 * Wires a concrete `localStorage`-like object in (from the app layer, which
 * has DOM lib) so the committed scenario survives a page reload. A corrupt
 * or schema-invalid stored payload -- e.g. hand-edited, or written by an
 * incompatible future version -- falls back to `null` (matching
 * `ui-store.ts`'s corrupt-payload behavior) rather than throwing during
 * store construction.
 */
export function createScenarioKeyValueStoragePersistence(
  storage: KeyValueStorage,
  key = "ballista:scenario",
): ScenarioPersistence {
  return {
    load() {
      const raw = storage.getItem(key);
      if (!raw) return null;
      try {
        return importScenarioFromJson(raw);
      } catch {
        return null;
      }
    },
    save(spec) {
      storage.setItem(key, exportScenarioToJson(spec));
    },
  };
}
