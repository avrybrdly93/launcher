import { z } from "zod";

/**
 * Declarative (JSON-serializable) description of a `DragCoefficientModel`
 * (§3.3). The asset loader (P1.26) turns this into a concrete
 * `ConstantCd`/`TabulatedReynoldsCd` instance; kept as plain data here so
 * `ProjectileSpec` can round-trip through JSON/zod without embedding class
 * instances.
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Declarative description of a `LiftCoefficientModel` (§3.6), same rationale as above. */
export const LiftCoefficientSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * Static physical description of a projectile (§3.9): $(m, R, C_d\text{-model},
 * C_L\text{-model}, \tau_\omega, \text{provenance})$. Every numeric datum
 * traces to a cited source via `provenance` — the asset loader (P1.26)
 * validates this schema at build time and rejects any asset missing one.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(), // kg
  radius: z.number().positive(), // m
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  spin: z.number().optional(), // rad/s, constant per §3.6
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

/**
 * Initial projectile asset library (§3.9): smooth sphere, golf ball, soccer
 * ball, baseball, table-tennis ball, cannonball (0.1 m iron), shot put.
 * Every numeric datum cites its source in `provenance`.
 */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  {
    id: "smooth-sphere",
    name: "Smooth reference sphere",
    mass: 0.5,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds" },
    provenance:
      "Idealized smooth sphere for Cd(Re) drag-crisis validation (Re~3e5 transition); " +
      "curve per Achenbach (1972), 'Experiments on the flow past spheres at very high Reynolds numbers', J. Fluid Mech. 54.",
  },
  {
    id: "golf-ball",
    name: "Golf ball",
    mass: 0.04593,
    radius: 0.021335,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    liftCoefficient: { kind: "saturating" },
    spin: 314, // ~3000 rpm typical driver backspin
    provenance:
      "Mass <=45.93 g, diameter >=42.67 mm per USGA/R&A Rules of Golf, Equipment Rules 2019, " +
      "sections 4.1a-4.1b; Cd~0.25 and dimpled-ball drag/lift behavior per Bearman & Harvey (1976), " +
      "'Golf ball aerodynamics', Aeronautical Quarterly 27.",
  },
  {
    id: "soccer-ball",
    name: "Soccer ball (football)",
    mass: 0.43,
    radius: 0.11,
    dragCoefficient: { kind: "constant", cd: 0.25 },
    provenance:
      "Mass 410-450 g, circumference 68-70 cm (radius ~0.108-0.111 m) per FIFA Laws of the Game 2023/24, " +
      "Law 2; Cd~0.25 in the flight-speed range per Asai et al. (2007), 'Fundamental aerodynamics of the soccer ball', " +
      "J. Sports Sci. 25.",
  },
  {
    id: "baseball",
    name: "Baseball",
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: { kind: "constant", cd: 0.35 },
    provenance:
      "Mass 5.00-5.25 oz (141.7-148.8 g), circumference 9-9.25 in (radius ~0.0362-0.0374 m) per MLB " +
      "Official Baseball Rules, Rule 3.01; Cd~0.3-0.4 per Adair, R.K. (2002), 'The Physics of Baseball', 3rd ed.",
  },
  {
    id: "table-tennis-ball",
    name: "Table-tennis ball",
    mass: 0.0027,
    radius: 0.02,
    dragCoefficient: { kind: "constant", cd: 0.5 },
    provenance:
      "Mass 2.7 g, diameter 40 mm per ITTF Table Tennis Equipment Regulations (2014 40+ plastic ball spec); " +
      "Cd~0.5 (subcritical smooth-sphere regime, Re~1e4) per Cross, R. (2011), 'Physics of Baseball & Softball' " +
      "ch. on ball aerodynamics (general subcritical-sphere Cd applies at this Re range).",
  },
  {
    id: "cannonball-iron-0.1m",
    name: "Cannonball (0.1 m iron)",
    mass: 4.121,
    radius: 0.05,
    dragCoefficient: { kind: "tabulated-reynolds" },
    provenance:
      "0.1 m diameter solid sphere, iron density rho=7870 kg/m^3 (CRC Handbook of Chemistry and Physics) " +
      "=> mass = rho*(4/3)*pi*r^3 ~ 4.121 kg; classic ballistics pedagogy example spanning the Cd(Re) drag crisis " +
      "at typical muzzle-velocity Reynolds numbers.",
  },
  {
    id: "shot-put",
    name: "Shot put (men's)",
    mass: 7.26,
    radius: 0.06,
    dragCoefficient: { kind: "constant", cd: 0.5 },
    provenance:
      "Mass 7.260 kg, diameter 110-130 mm per World Athletics Technical Rules 2024, Rule 33 (men's shot); " +
      "Cd~0.5 (subcritical smooth-sphere approximation) -- aerodynamic drag is negligible relative to gravity " +
      "at shot-put release speeds (low-Pi regime, blueprint sec 3.8).",
  },
];
