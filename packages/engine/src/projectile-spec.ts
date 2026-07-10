import { z } from "zod";
import { parseArrayWithSchema } from "./schema.js";

/**
 * Serializable description of a `DragCoefficientModel` (§3.3): data, not a
 * class instance, so it can round-trip through JSON/zod. The asset loader
 * (P1.26) maps this to a `ConstantCd`/`TabulatedReynoldsCd` instance.
 */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().nonnegative() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Serializable description of a `LiftCoefficientModel` (§3.6), same rationale as `DragModelSpec`. */
export const LiftModelSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$. This is the serializable asset record —
 * `createSphericalProjectileParams` + a drag/lift-model factory (P1.26)
 * turns one of these into the runtime `ProjectileParams` a `Model` actually
 * consumes. Every asset carries a non-empty `provenance` citation for its
 * numeric data (§3.9: "every numeric datum carries a citation field").
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema.optional(),
  /** Spin decay time constant τ_ω (s), eq. §3.6: ω̇ = -ω/τ_ω. Sport-typical range 20-30s. */
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/**
 * Validates a raw (e.g. JSON-sourced or user-supplied "custom" projectile)
 * list against `ProjectileSpecSchema`, one entry at a time, so a corrupt
 * fixture is reported against the specific asset it belongs to — the asset
 * loader of §3.9/P1.26. `PROJECTILE_ASSETS` below is threaded through this
 * at module load, so a corrupt built-in fixture fails the moment anything
 * imports it, before it ever reaches a build or a running app.
 */
export function loadProjectileAssets(raw: readonly unknown[]): readonly ProjectileSpec[] {
  return parseArrayWithSchema(ProjectileSpecSchema, raw, (item) =>
    typeof item === "object" && item !== null && "id" in item
      ? String((item as { id: unknown }).id)
      : "(missing id)",
  );
}

/**
 * Initial projectile asset library (§3.9): smooth sphere, golf, soccer,
 * baseball, table-tennis, cannonball, shot put. Values are drawn from the
 * cited rulebooks/references; where a rule gives a range, the spec uses the
 * range's midpoint.
 */
const RAW_PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.5,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "Canonical subcritical smooth-sphere drag coefficient Cd~0.47 (Munson, Fundamentals of Fluid Mechanics); mass/radius are an arbitrary reference case, not a real object.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.0459,
    radius: 0.02135,
    dragModel: { kind: "constant", cd: 0.25 },
    liftModel: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "USGA/R&A Rules of Golf: minimum diameter 42.67 mm, maximum mass 45.93 g. Cd~0.25 typical dimpled-ball value, dimples trip the boundary layer and delay separation (Bearman & Harvey, 1976).",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.11,
    dragModel: { kind: "tabulated-reynolds" },
    provenance:
      "FIFA Quality Standard: circumference 68-70 cm (midpoint diameter used), mass 410-450 g (midpoint used). At typical match speeds (~10-30 m/s) Re sits near the smooth-sphere drag crisis (Achenbach, 1972), hence the tabulated Cd(Re) model rather than a constant.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", cd: 0.35 },
    liftModel: { kind: "saturating" },
    spinDecayTau: 25,
    provenance:
      "MLB Official Baseball Rule 3.01: circumference 9-9.25 in, weight 5-5.25 oz (midpoints used). Cd~0.3-0.4 for a seamed baseball at typical pitch speeds (Adair, The Physics of Baseball, 2002); midpoint 0.35 used.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "tabulated-reynolds" },
    liftModel: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "ITTF Table Tennis Rules of the Game: ball diameter 40 mm, mass 2.7 g. At typical rally speeds (~10-20 m/s) Re~1e4-1e5, pre-drag-crisis (Achenbach, 1972), hence the tabulated Cd(Re) model.",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "0.1 m diameter solid iron sphere (historical smoothbore-cannon reference shot). Mass derived from iron density 7870 kg/m^3 x sphere volume ((4/3)*pi*r^3) = 4.12 kg. Cd~0.47 subcritical smooth-sphere value (Munson, Fundamentals of Fluid Mechanics).",
  },
  {
    id: "shot-put",
    name: "Shot put",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.47 },
    provenance:
      "World Athletics Rule 188 (men's shot): mass 7.260 kg, diameter 110-130 mm (midpoint 120 mm used). Cd~0.47 smooth-sphere approximation; drag is negligible at shot-put release speeds and mass (low-Pi regime).",
  },
];

export const PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  loadProjectileAssets(RAW_PROJECTILE_ASSETS);
