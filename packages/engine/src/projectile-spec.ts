import { z } from "zod";

/** How a `ProjectileSpec` asset selects its drag coefficient model (§3.3). */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulatedReynoldsSmoothSphere") }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** How a `ProjectileSpec` asset selects its lift (Magnus) coefficient model (§3.6). */
export const LiftModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("saturating") }),
]);
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * Static, serializable description of a projectile asset (§3.9): mass,
 * radius, drag/lift model selection, optional spin-decay time constant, and
 * a mandatory provenance string citing where the numbers came from. This is
 * plain data (zod-validated JSON) -- assembling it into a runtime
 * `ProjectileParams` with live `DragCoefficientModel`/`LiftCoefficientModel`
 * instances is the asset loader's job (P1.26).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema,
  spinDecayTau: z.number().positive().optional(), // s
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/**
 * Initial projectile asset library (§3.9). Numbers are literature/rulebook
 * figures for pedagogical realism, not measured-and-certified data -- each
 * entry's `provenance` documents its source per the platform's V&V stance
 * (§4.10-adjacent honesty layer).
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth sphere (reference)",
    mass: 0.2,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.47 },
    liftModel: { kind: "none" },
    provenance:
      "Idealized reference case: subcritical smooth-sphere Cd=0.47 (Clift, Grace & Weber, Bubbles, Drops, and Particles, 1978); mass/radius chosen for a mid-range Pi.",
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
      "USGA/R&A Rules of Golf Appendix III: mass <= 45.93 g, diameter >= 42.67 mm; Cd ~= 0.25 dimpled operating range per blueprint SS3.3.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball",
    mass: 0.43,
    radius: 0.1115,
    dragModel: { kind: "constant", cd: 0.25 },
    liftModel: { kind: "none" },
    provenance: "FIFA Quality Pro spec: mass 420-450 g, circumference 68-70 cm.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragModel: { kind: "constant", cd: 0.35 },
    liftModel: { kind: "saturating" },
    spinDecayTau: 20,
    provenance:
      "MLB Official Baseball Rule 3.01: mass 142-149 g, circumference 22.9-23.5 cm; Cd ~= 0.3-0.4 seam-dependent (Adair, The Physics of Baseball, 3rd ed.).",
  },
  {
    id: "table-tennis-ball",
    name: "Table tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragModel: { kind: "constant", cd: 0.47 },
    liftModel: { kind: "none" },
    provenance:
      "ITTF equipment spec: mass 2.7 g, diameter 40 mm; smooth-sphere Cd assumed (its low mass drives a large Pi, the platform's high-drag-ratio exhibit).",
  },
  {
    id: "cannonball",
    name: "Cannonball (0.1 m iron)",
    mass: 4.12,
    radius: 0.05,
    dragModel: { kind: "constant", cd: 0.5 },
    liftModel: { kind: "none" },
    provenance:
      "0.1 m diameter solid iron sphere, rho_iron=7870 kg/m^3 => m=(4/3)*pi*r^3*rho ~= 4.12 kg; historical smoothbore reference case (blueprint SS3.9).",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragModel: { kind: "constant", cd: 0.47 },
    liftModel: { kind: "none" },
    provenance:
      "World Athletics Rule 188: men's shot mass 7.260 kg, diameter 110-130 mm (using 120 mm midpoint).",
  },
];
