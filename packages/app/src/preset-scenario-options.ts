import { PRESET_SCENARIOS, SCENARIO_LIBRARY, type ScenarioSpec } from "@ballista/engine";

/**
 * The seven `PRESET_SCENARIOS` as `<select>` options, keyed and labelled by
 * their **curated** identity rather than by their projectile's (P0.115).
 *
 * `convergence-study-route.tsx` and `stability-explorer-route.tsx` both built
 * this list independently as `PRESET_SCENARIOS.map((spec) => ({ id:
 * spec.projectile.id, label: spec.projectile.name, spec }))`, and a projectile
 * is not a scenario. Two presets are the *same* baseball fired the *same* way
 * into opposite winds -- the matched headwind/tailwind pair `scenario-library.ts`
 * exists to let a user compare -- so both options came out with
 * `id="baseball"` and the label "Baseball":
 *
 *   - the two were indistinguishable in the dropdown, and
 *   - `SCENARIO_OPTIONS.find((option) => option.id === scenarioId)` returns the
 *     first match, so picking the second one silently studied the first. The
 *     tailwind scenario was unreachable from either route.
 *
 * Preact was saying so on every page load ("two or more children with the same
 * key attribute: baseball"); nothing was listening until a browser test started
 * failing the console.
 *
 * `PRESET_CURATION` already carries the unique id and human title for each of
 * the seven ("headwind" / "Batted ball into a headwind"), and `curatedPresets()`
 * pairs them with the specs by index, so the identity is taken from there rather
 * than invented here. The reference equality below is exactly that pairing:
 * `curatedPresets()` spreads the curation over `PRESET_SCENARIOS[i]` itself, so
 * a library entry's `spec` *is* the preset object, not a copy.
 */
export interface PresetScenarioOption {
  readonly id: string;
  readonly label: string;
  readonly spec: ScenarioSpec;
}

export const PRESET_SCENARIO_OPTIONS: readonly PresetScenarioOption[] = SCENARIO_LIBRARY.filter(
  (entry) => (PRESET_SCENARIOS as readonly ScenarioSpec[]).includes(entry.spec),
).map((entry) => ({ id: entry.id, label: entry.title, spec: entry.spec }));
