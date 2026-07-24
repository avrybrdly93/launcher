import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import {
  ALL_REGIME_TAGS,
  filterPresetsByTag,
  PRESET_BROWSER_ENTRIES,
  regimeTagLabel,
} from "./preset-browser-logic.js";

describe("PRESET_BROWSER_ENTRIES", () => {
  it("has one entry per preset scenario, each carrying its own regime tags", () => {
    expect(PRESET_BROWSER_ENTRIES).toHaveLength(PRESET_SCENARIOS.length);
    expect(PRESET_BROWSER_ENTRIES.map((e) => e.spec)).toEqual(PRESET_SCENARIOS);
    for (const entry of PRESET_BROWSER_ENTRIES) {
      expect(entry.tags.length).toBeGreaterThan(0);
    }
  });
});

describe("filterPresetsByTag (P3.33 validation criterion: filtering by tag works)", () => {
  it("tag === null returns every entry, unfiltered", () => {
    expect(filterPresetsByTag(PRESET_BROWSER_ENTRIES, null)).toEqual(PRESET_BROWSER_ENTRIES);
  });

  it("filtering by 'magnus' returns exactly the golf-drive preset", () => {
    const filtered = filterPresetsByTag(PRESET_BROWSER_ENTRIES, "magnus");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.spec.projectile.id).toBe("golf-ball");
  });

  it("filtering by 'stiff' returns exactly the dust-grain preset", () => {
    const filtered = filterPresetsByTag(PRESET_BROWSER_ENTRIES, "stiff");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.spec.projectile.id).toBe("dust-grain");
  });

  it("filtering by 'low-pi' includes the shot put and excludes the table-tennis ball", () => {
    const filtered = filterPresetsByTag(PRESET_BROWSER_ENTRIES, "low-pi");
    const ids = filtered.map((e) => e.spec.projectile.id);
    expect(ids).toContain("shot-put");
    expect(ids).not.toContain("table-tennis-ball");
  });

  it("filtering by 'high-pi' includes the table-tennis ball and excludes the shot put", () => {
    const filtered = filterPresetsByTag(PRESET_BROWSER_ENTRIES, "high-pi");
    const ids = filtered.map((e) => e.spec.projectile.id);
    expect(ids).toContain("table-tennis-ball");
    expect(ids).not.toContain("shot-put");
  });

  it("every entry returned by a tag filter actually carries that tag", () => {
    for (const tag of ALL_REGIME_TAGS) {
      for (const entry of filterPresetsByTag(PRESET_BROWSER_ENTRIES, tag)) {
        expect(entry.tags).toContain(tag);
      }
    }
  });

  it("low-pi ∪ high-pi partitions the full library (every preset in exactly one)", () => {
    const low = filterPresetsByTag(PRESET_BROWSER_ENTRIES, "low-pi");
    const high = filterPresetsByTag(PRESET_BROWSER_ENTRIES, "high-pi");
    expect(low.length + high.length).toBe(PRESET_BROWSER_ENTRIES.length);
  });
});

describe("regimeTagLabel", () => {
  it("gives every tag a distinct, non-empty label", () => {
    const labels = ALL_REGIME_TAGS.map(regimeTagLabel);
    expect(new Set(labels).size).toBe(ALL_REGIME_TAGS.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });
});
