/**
 * Projectile panel's non-rendering logic (§6.3 panel group 2: "preset
 * dropdown + custom mass/radius/C_d model"; P3.20). Split out from the
 * `.tsx` component (`projectile-panel.tsx`) so preset lookup and the
 * custom/preset transitions -- this task's actual validation surface --
 * are directly unit-testable without a DOM.
 */

import { z } from "zod";
import { PROJECTILE_ASSETS, type ProjectileSpec } from "@ballista/engine";

/** The synthetic id a hand-edited (non-catalog) projectile carries. */
export const CUSTOM_PROJECTILE_ID = "custom";

/**
 * Custom-editing scope (v1): mass, radius, and -- only when the current
 * drag model is a single constant C_d, not a tabulated Re-dependent curve
 * -- that coefficient. A tabulated drag model has no single number to
 * expose as a slider, so it's carried over unedited rather than guessed at
 * (mirrors `schema-controls.ts`'s "skip, don't guess" contract for a field
 * this generator can't map to a control).
 */
export const customProjectileParamsSchema = z.object({
  mass: z.number().min(0.001).max(50).step(0.001).describe("Mass|kg"),
  radius: z.number().min(0.001).max(1).step(0.001).describe("Radius|m"),
});

export const customDragCoefficientSchema = z.object({
  dragCoefficient: z.number().min(0.01).max(2).step(0.01).describe("Drag coefficient Cd"),
});

/** Finds a catalog preset by its `PROJECTILE_ASSETS` id, or `undefined` for `CUSTOM_PROJECTILE_ID`/an unknown id. */
export function findProjectilePreset(id: string): ProjectileSpec | undefined {
  return PROJECTILE_ASSETS.find((preset) => preset.id === id);
}

/**
 * Seeds a custom projectile spec from `current` -- the "custom persists in
 * draft" transition (this task's validation criterion): switching *into*
 * custom carries over the current mass/radius/drag/lift model rather than
 * resetting to arbitrary defaults, so the projectile's physical behavior
 * doesn't jump the instant the dropdown flips to "Custom". Only `id`/`name`
 * change.
 */
export function toCustomProjectileSpec(current: ProjectileSpec): ProjectileSpec {
  return {
    ...current,
    id: CUSTOM_PROJECTILE_ID,
    name: "Custom",
    provenance: `Custom, derived from "${current.name}".`,
  };
}

/** `true` iff `dragModel` is a single constant C_d this panel can expose as a slider. */
export function hasEditableDragCoefficient(
  dragModel: ProjectileSpec["dragModel"],
): dragModel is { readonly kind: "constant"; readonly cd: number } {
  return dragModel.kind === "constant";
}
