/**
 * P4.20 "how big are the effects we ignore?" exercise (blueprint §3.4, §5.5
 * worked example 1). Buoyancy is a real, small, toggleable force -- already
 * wired end-to-end via `BuoyancyForce` (P1.16) and the standard Forces panel
 * (auto-UI, `forces-panel-logic.ts`) -- so the only missing piece is
 * presenting *how* small it is for a representative preset. Added-mass
 * effects are deliberately not modeled at all (relevant only when
 * rho_body ~ rho_air, far from any preset here), so there is no
 * corresponding ratio to compute for them; that's a documentation note on
 * the page itself (`@ballista/ui`'s `NeglectedEffectsPage`), not a runtime
 * computation.
 */
import {
  ISA,
  PROJECTILE_ASSETS,
  buoyancyToWeightRatio,
  projectileSpecToParams,
} from "@ballista/engine";

/** Soccer ball: the same preset the blueprint's own §3.4 text quotes ("for a soccer ball this is ~1% of weight"). */
const NEGLECTED_EFFECTS_PRESET_ID = "soccer-ball";

export interface NeglectedEffectsResult {
  readonly presetId: string;
  readonly presetName: string;
  readonly mass: number;
  readonly radius: number;
  readonly volume: number;
  readonly rhoAir: number;
  readonly buoyancyToWeightRatio: number;
}

/**
 * Computes the buoyancy-to-weight ratio for {@link NEGLECTED_EFFECTS_PRESET_ID}
 * at sea-level ISA air density, reusing `PROJECTILE_ASSETS` (the single
 * source of truth for preset mass/radius, §3.9) rather than duplicating its
 * literals.
 */
export function computeNeglectedEffects(): NeglectedEffectsResult {
  const spec = PROJECTILE_ASSETS.find((asset) => asset.id === NEGLECTED_EFFECTS_PRESET_ID);
  if (!spec) {
    throw new Error(`Missing "${NEGLECTED_EFFECTS_PRESET_ID}" in PROJECTILE_ASSETS`);
  }
  const params = projectileSpecToParams(spec);
  return {
    presetId: spec.id,
    presetName: spec.name,
    mass: params.mass,
    radius: params.radius,
    volume: params.volume,
    rhoAir: ISA.rho0,
    buoyancyToWeightRatio: buoyancyToWeightRatio(params, ISA.rho0),
  };
}
