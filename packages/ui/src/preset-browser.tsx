/**
 * Preset browser panel (§6.3 panel group 7; P3.33). A tag filter chip row
 * (`ALL_REGIME_TAGS`, plus an implicit "All") over `PRESET_BROWSER_ENTRIES`;
 * selecting a preset commits its full `ScenarioSpec`, mirroring
 * `ProjectilePanel`'s "select swaps in the whole spec" contract.
 */

import type { ScenarioSpec } from "@ballista/engine";
import {
  ALL_REGIME_TAGS,
  filterPresetsByTag,
  PRESET_BROWSER_ENTRIES,
  regimeTagLabel,
  type RegimeTag,
} from "./preset-browser-logic.js";

export interface PresetBrowserProps {
  readonly selectedTag: RegimeTag | null;
  readonly onSelectTag: (tag: RegimeTag | null) => void;
  readonly onSelectPreset: (spec: ScenarioSpec) => void;
}

export function PresetBrowser({ selectedTag, onSelectTag, onSelectPreset }: PresetBrowserProps) {
  const visible = filterPresetsByTag(PRESET_BROWSER_ENTRIES, selectedTag);

  return (
    <div class="preset-browser" data-testid="preset-browser">
      <div class="preset-browser-tags" data-testid="preset-browser-tags" role="group">
        <button
          type="button"
          class="preset-browser-tag"
          data-testid="preset-browser-tag-all"
          aria-pressed={selectedTag === null}
          onClick={() => onSelectTag(null)}
        >
          All
        </button>
        {ALL_REGIME_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            class="preset-browser-tag"
            data-testid={`preset-browser-tag-${tag}`}
            aria-pressed={selectedTag === tag}
            onClick={() => onSelectTag(tag)}
          >
            {regimeTagLabel(tag)}
          </button>
        ))}
      </div>

      <ul class="preset-browser-list" data-testid="preset-browser-list">
        {visible.map(({ spec, tags }) => (
          <li
            key={spec.projectile.id}
            class="preset-browser-entry"
            data-testid="preset-browser-entry"
          >
            <button
              type="button"
              class="preset-browser-entry-select"
              onClick={() => onSelectPreset(spec)}
            >
              {spec.projectile.name}
            </button>
            <span class="preset-browser-entry-tags">
              {tags.map((tag) => regimeTagLabel(tag)).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
