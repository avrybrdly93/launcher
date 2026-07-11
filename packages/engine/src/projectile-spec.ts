import { z } from "zod";
import { parseWithSchema, type Schema } from "./schema.js";

/** A numeric datum paired with its citation (§3.9: "every numeric datum carries a citation field"). */
export const ProvenancedNumberSchema = z.object({
  value: z.number(),
  citation: z.string().min(1),
});
export type ProvenancedNumber = z.infer<typeof ProvenancedNumberSchema>;

const ConstantCdSpecSchema = z.object({
  kind: z.literal("constant"),
  cd: ProvenancedNumberSchema,
});

const TabulatedReynoldsCdSpecSchema = z.object({
  kind: z.literal("tabulated-reynolds"),
  citation: z.string().min(1),
});

const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  ConstantCdSpecSchema,
  TabulatedReynoldsCdSpecSchema,
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/**
 * Serializable, schema-validated description of a projectile (§3.9): mass,
 * radius, drag model, and a citation for every numeric datum. Distinct from
 * `ProjectileParams` (the derived runtime object with `area`/`volume` and a
 * concrete `DragCoefficientModel` instance) -- turning a spec into a
 * runnable `ProjectileParams` is the asset loader's job (P1.26).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: ProvenancedNumberSchema, // kg
  radius: ProvenancedNumberSchema, // m
  dragCoefficient: DragCoefficientSpecSchema,
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

const SMOOTH_SPHERE_CD: DragCoefficientSpec = {
  kind: "tabulated-reynolds",
  citation:
    "Smooth-sphere Cd(Re) incl. drag crisis, standard aerodynamics-textbook curve; table per SMOOTH_SPHERE_CD_TABLE (§3.3 option 2).",
};

/**
 * Initial projectile asset library (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * "custom" from the blueprint's asset list is a UI-authored spec (P3.20),
 * not a fixed asset with real-world provenance, so it is not enumerated here.
 *
 * Left untyped (`unknown[]`) and unexported: this is the *raw* fixture data,
 * the thing an asset-authoring mistake would actually corrupt. It only
 * becomes the trusted `ProjectileSpec[]` below by passing through
 * `loadProjectileAssets`.
 */
const RAW_PROJECTILE_ASSETS: readonly unknown[] = [
  {
    id: "sphere",
    name: "Smooth sphere (reference)",
    mass: {
      value: 0.5,
      citation:
        "Generic pedagogical reference sphere; round numbers, not modeled on a specific real object.",
    },
    radius: {
      value: 0.05,
      citation:
        "Generic pedagogical reference sphere; round numbers, not modeled on a specific real object.",
    },
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "Reference case for teaching drag/Cd(Re) behavior; not modeled on a specific real object.",
  },
  {
    id: "golf",
    name: "Golf ball",
    mass: {
      value: 0.04593,
      citation: "USGA/R&A Rules of Golf, Equipment Rules: mass not to exceed 45.93 g.",
    },
    radius: {
      value: 0.021335,
      citation: "USGA/R&A Rules of Golf, Equipment Rules: diameter not less than 42.67 mm.",
    },
    dragCoefficient: {
      kind: "constant",
      cd: {
        value: 0.25,
        citation:
          "Typical dimpled-golf-ball Cd at driver speeds (~0.2-0.3), standard sports-aerodynamics literature.",
      },
    },
    provenance:
      "USGA/R&A Rules of Golf (mass/diameter); Cd is a typical literature value for a dimpled ball, not measured.",
  },
  {
    id: "soccer",
    name: "Soccer ball (size 5)",
    mass: {
      value: 0.43,
      citation: "FIFA Laws of the Game, Law 2: size 5 ball mass 410-450 g (midpoint used).",
    },
    radius: {
      value: 0.11,
      citation: "FIFA Laws of the Game, Law 2: size 5 ball circumference 68-70 cm (midpoint used).",
    },
    dragCoefficient: {
      kind: "constant",
      cd: {
        value: 0.25,
        citation:
          "Typical soccer-ball Cd at match speeds (~0.2-0.3), standard sports-aerodynamics literature.",
      },
    },
    provenance:
      "FIFA Laws of the Game (mass/circumference); Cd is a typical literature value, not measured.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: {
      value: 0.145,
      citation:
        "MLB Official Baseball Rules 3.01: mass 5.00-5.25 oz (141.7-148.8 g, ~0.145 kg used).",
    },
    radius: {
      value: 0.0366,
      citation:
        "MLB Official Baseball Rules 3.01: circumference 9-9.25 in (~0.0366 m radius used).",
    },
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "MLB Official Baseball Rules 3.01 (mass/circumference); Cd approximated via smooth-sphere Cd(Re).",
  },
  {
    id: "table-tennis",
    name: "Table tennis ball",
    mass: { value: 0.0027, citation: "ITTF Equipment Regulations: ball mass 2.7 g." },
    radius: { value: 0.02, citation: "ITTF Equipment Regulations: ball diameter 40 mm." },
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "ITTF Equipment Regulations (mass/diameter); Cd approximated via smooth-sphere Cd(Re).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: {
      value: 4.121,
      citation:
        "Solid sphere, 0.1 m diameter, cast-iron density ~7870 kg/m^3 (standard iron density): m = rho*(4/3)*pi*r^3.",
    },
    radius: { value: 0.05, citation: "Specified as a 0.1 m diameter iron ball (§3.9)." },
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "0.1 m diameter solid cast-iron sphere per §3.9; mass derived from standard iron density.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: {
      value: 7.26,
      citation: "World Athletics Technical Rules, Rule 33: men's shot mass 7.260 kg.",
    },
    radius: {
      value: 0.06,
      citation:
        "World Athletics Technical Rules, Rule 33: shot diameter 110-130 mm (midpoint used).",
    },
    dragCoefficient: SMOOTH_SPHERE_CD,
    provenance:
      "World Athletics Technical Rules, Rule 33 (mass/diameter); Cd approximated via smooth-sphere Cd(Re).",
  },
];

/**
 * Asset loader (P1.26): parses+validates every raw asset against
 * `ProjectileSpecSchema`, throwing a `SchemaValidationError` (field path +
 * reason per issue, all issues in one message) on the first corrupt entry.
 * `PROJECTILE_ASSETS` below calls this eagerly at module-load time, so a
 * corrupt fixture fails the build immediately rather than surfacing as a
 * runtime crash deep inside a simulation.
 */
export function loadProjectileAssets(assets: readonly unknown[]): readonly ProjectileSpec[] {
  return assets.map((asset) =>
    parseWithSchema(ProjectileSpecSchema as Schema<ProjectileSpec>, asset),
  );
}

/** The validated initial projectile asset library (§3.9) -- schema-checked at import time. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] =
  loadProjectileAssets(RAW_PROJECTILE_ASSETS);
