import { z } from "zod";

/**
 * Serializable description of a drag-coefficient model (§3.3), resolved to a
 * `DragCoefficientModel` instance by the asset loader (P1.26). "tabulated-
 * reynolds" refers to the built-in smooth-sphere Cd(Re) curve (P1.12); a
 * custom per-sport table is out of scope here (P4.05).
 */
export const DragCoefficientSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), value: z.number().positive() }),
  z.object({ type: z.literal("tabulated-reynolds") }),
]);
export type DragCoefficientSpec = z.infer<typeof DragCoefficientSpecSchema>;

/** Serializable description of a lift-coefficient model (§3.6), mirroring `SaturatingLiftCoefficient`'s params. */
export const LiftCoefficientSpecSchema = z.object({
  type: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftCoefficientSpec = z.infer<typeof LiftCoefficientSpecSchema>;

/**
 * `ProjectileSpec` (§3.9): $(m, R, C_d\text{-model}, C_L\text{-model},
 * \tau_\omega, \text{provenance})$. This is the serializable, citable data
 * form; `createSphericalProjectileParams`-style resolution into a runtime
 * `ProjectileParams` (with live model instances) is the asset loader's job
 * (P1.26).
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragCoefficient: DragCoefficientSpecSchema,
  liftCoefficient: LiftCoefficientSpecSchema.optional(),
  /** Spin decay time constant, s. Metadata only — no spin-decay ODE is wired in yet. */
  spinDecayTau: z.number().positive().optional(),
  /** Citation for every numeric datum above (§3.9: "every numeric datum carries a citation field"). */
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

const IRON_DENSITY_KG_M3 = 7870; // standard wrought/cast iron density

function sphereMass(radius: number, density: number): number {
  return density * ((4 / 3) * Math.PI * radius * radius * radius);
}

/** Generic 10 cm sphere driving the drag-crisis exhibit (P1.12); not a specific real object. */
export const SMOOTH_SPHERE_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "smooth-sphere",
  name: "Smooth reference sphere",
  mass: 0.1,
  radius: 0.05,
  dragCoefficient: { type: "tabulated-reynolds" },
  provenance:
    "Generic 10 cm smooth sphere for the drag-crisis teaching exhibit (P1.12); Cd(Re) is the platform's approximate literature fit (SMOOTH_SPHERE_CD_TABLE), not a measured specimen.",
});

export const GOLF_BALL_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "golf-ball",
  name: "Golf ball",
  mass: 0.04593,
  radius: 0.04267 / 2,
  dragCoefficient: { type: "constant", value: 0.25 },
  liftCoefficient: { type: "saturating" },
  provenance:
    "USGA/R&A Rules of Golf, Equipment Rules (mass ≤ 45.93 g, diameter ≥ 42.67 mm); Cd ≈ 0.25 dimpled-ball operating-range value per blueprint §3.4.",
});

export const SOCCER_BALL_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "soccer-ball",
  name: "Soccer ball",
  mass: 0.43,
  radius: 0.22 / 2,
  dragCoefficient: { type: "constant", value: 0.25 },
  provenance:
    "FIFA Laws of the Game, Law 2 (mass 410-450 g, midpoint 430 g; circumference 68-70 cm → diameter ≈ 22 cm); Cd ≈ 0.25 typical match-ball value (Asai et al. 2007, J. Sports Sci.).",
});

export const BASEBALL_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "baseball",
  name: "Baseball",
  mass: 0.145,
  radius: 0.0366,
  dragCoefficient: { type: "constant", value: 0.35 },
  liftCoefficient: { type: "saturating" },
  provenance:
    "Official Baseball Rules 3.01 (mass 142-149 g, ≈145 g typical; circumference 9-9.25 in → radius ≈ 36.6 mm); Cd ≈ 0.3-0.4 per Adair, 'The Physics of Baseball'.",
});

export const TABLE_TENNIS_BALL_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "table-tennis-ball",
  name: "Table tennis ball",
  mass: 0.0027,
  radius: 0.04 / 2,
  dragCoefficient: { type: "constant", value: 0.4 },
  provenance:
    "ITTF Table Tennis Equipment Regulations (mass 2.67-2.77 g; diameter 40 mm); Cd ≈ 0.4 low-Reynolds smooth-sphere estimate.",
});

export const CANNONBALL_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "cannonball",
  name: "Cannonball (0.1 m iron)",
  mass: sphereMass(0.05, IRON_DENSITY_KG_M3),
  radius: 0.05,
  dragCoefficient: { type: "constant", value: 0.47 },
  provenance:
    "0.1 m diameter solid iron sphere; mass derived from standard iron density 7870 kg/m^3; Cd = 0.47 smooth-sphere subcritical value.",
});

export const SHOT_PUT_SPEC: ProjectileSpec = ProjectileSpecSchema.parse({
  id: "shot-put",
  name: "Shot put (men's, 7.26 kg)",
  mass: 7.26,
  radius: 0.12 / 2,
  dragCoefficient: { type: "constant", value: 0.47 },
  provenance:
    "World Athletics Technical Rules C2.1 (men's shot: mass 7.260 kg, diameter 110-130 mm, midpoint 120 mm); Cd ≈ 0.47 smooth-sphere approximation.",
});

/** The Phase 1 initial asset library (§3.9): sphere, golf, soccer, baseball, TT ball, cannonball, shot put. */
export const PROJECTILE_ASSETS: readonly ProjectileSpec[] = [
  SMOOTH_SPHERE_SPEC,
  GOLF_BALL_SPEC,
  SOCCER_BALL_SPEC,
  BASEBALL_SPEC,
  TABLE_TENNIS_BALL_SPEC,
  CANNONBALL_SPEC,
  SHOT_PUT_SPEC,
];
