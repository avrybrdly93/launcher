/**
 * Preset browser (§6.3 panel group 7: "scenario library"; P3.33's "preset
 * browser with regime tags (Π, stiff, Magnus)"). Pure data/filtering logic,
 * split from `preset-browser.tsx` per this package's established
 * `<feature>-panel-logic.ts` convention.
 */
import {
  PRESET_SCENARIOS,
  scenarioRegimeTags,
  type RegimeTag,
  type ScenarioSpec,
} from "@ballista/engine";

export type { RegimeTag };
export { ALL_REGIME_TAGS } from "@ballista/engine";

/** One preset in the library, paired with its computed regime tags. */
export interface PresetBrowserEntry {
  readonly spec: ScenarioSpec;
  readonly tags: readonly RegimeTag[];
}

/** The full preset library with tags precomputed once (`scenarioRegimeTags` is a pure function of the spec, so this never goes stale). */
export const PRESET_BROWSER_ENTRIES: readonly PresetBrowserEntry[] = PRESET_SCENARIOS.map(
  (spec) => ({ spec, tags: scenarioRegimeTags(spec) }),
);

/**
 * Filters `entries` down to those carrying `tag` (this task's validation
 * criterion). `tag === null` ("all presets", the browser's default state)
 * returns every entry unfiltered.
 */
export function filterPresetsByTag(
  entries: readonly PresetBrowserEntry[],
  tag: RegimeTag | null,
): readonly PresetBrowserEntry[] {
  if (tag === null) return entries;
  return entries.filter((entry) => entry.tags.includes(tag));
}

/** Human-readable label for a regime tag chip. */
export function regimeTagLabel(tag: RegimeTag): string {
  switch (tag) {
    case "low-pi":
      return "Low Π (drag-negligible)";
    case "high-pi":
      return "High Π (drag-dominated)";
    case "magnus":
      return "Magnus (spin)";
    case "stiff":
      return "Stiff";
  }
}
