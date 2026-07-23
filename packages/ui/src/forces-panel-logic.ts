/**
 * Forces panel's non-rendering logic (§6.3 panel group 4: "per-force enable
 * toggles with live badge showing current magnitude at playhead"; P3.22).
 * Split out from the `.tsx` component for the same reason
 * `projectile-panel-logic.ts`/`environment-panel-logic.ts` are: the toggle
 * transition and badge lookup are directly unit-testable without a DOM.
 */

import { KNOWN_FORCE_IDS } from "@ballista/runtime";
import type { ForceGlyphSet } from "@ballista/viz";

/** Human label per force id, in `KNOWN_FORCE_IDS`'s own registration order (the panel's row order). */
export const FORCE_LABELS: Readonly<Record<string, string>> = {
  gravity: "Gravity",
  "drag-linear": "Linear drag",
  "drag-quadratic": "Quadratic drag",
  magnus: "Magnus (spin)",
  buoyancy: "Buoyancy",
};

/**
 * `KNOWN_FORCE_IDS` paired with its label -- a test failure here (rather
 * than a toggle silently rendering a blank label) is the signal that a
 * force was added to the engine's registry without a matching panel label.
 */
export const FORCE_TOGGLES: readonly { readonly id: string; readonly label: string }[] =
  KNOWN_FORCE_IDS.map((id) => ({ id, label: FORCE_LABELS[id] ?? id }));

/**
 * Toggles `id` in `forceIds`: removes it if present, appends it if absent --
 * except removing the *last* remaining id, which is a no-op (`ScenarioSpec`'s
 * `model.forceIds` must stay non-empty, §5.2/`scenario-spec.ts`'s
 * `z.array(...).min(1)`; a scenario with zero forces has nothing to
 * integrate).
 */
export function toggleForceId(forceIds: readonly string[], id: string): readonly string[] {
  const isEnabled = forceIds.includes(id);
  if (isEnabled) {
    if (forceIds.length <= 1) return forceIds;
    return forceIds.filter((existing) => existing !== id);
  }
  return [...forceIds, id];
}

/** The badge value for `id`: its magnitude from `glyphSet` (P3.22 "badge equals |F| channel at playhead"), or `undefined` when the force isn't currently wired (no live instance, so nothing to sample) or no result exists yet. */
export function badgeMagnitude(
  glyphSet: ForceGlyphSet | undefined,
  id: string,
): number | undefined {
  return glyphSet?.forces.find((glyph) => glyph.id === id)?.magnitude;
}
