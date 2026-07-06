import { z } from "zod";
import type { Schema } from "./schema.js";

/** Which `DragCoefficientModel` implementation a ProjectileSpec resolves to (§3.3). */
export const DRAG_MODEL_KINDS = ["constant", "tabulated-reynolds"] as const;
export type DragModelKind = (typeof DRAG_MODEL_KINDS)[number];

/**
 * Declarative, serializable projectile description (§3.9): the data-asset
 * format the projectile library ships as JSON/objects. The asset loader
 * (P1.26) resolves this into a runtime `ProjectileParams` with live
 * DragCoefficientModel/LiftCoefficientModel instances; this type carries no
 * behavior, only data + provenance, so it round-trips through
 * ScenarioSpec/localStorage/share-URLs untouched.
 */
export interface ProjectileSpec {
  readonly id: string;
  readonly name: string;
  readonly mass: number; // kg
  readonly radius: number; // m
  readonly dragModel: DragModelKind;
  /** Required (and only meaningful) when dragModel === "constant" (§3.3 option 1). */
  readonly constantCd?: number | undefined;
  readonly liftModel?: "saturating" | undefined;
  /** Spin decay time constant tau_omega, seconds; omit to disable spin decay (§3.6). */
  readonly spinDecayTau?: number | undefined;
  /** Citation for the numeric data — every datum here must trace to a source (§3.9). */
  readonly provenance: string;
}

export const ProjectileSpecSchema: Schema<ProjectileSpec> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mass: z.number().positive(),
    radius: z.number().positive(),
    dragModel: z.enum(DRAG_MODEL_KINDS),
    constantCd: z.number().positive().optional(),
    liftModel: z.literal("saturating").optional(),
    spinDecayTau: z.number().positive().optional(),
    provenance: z.string().min(1),
  })
  .refine((spec) => spec.dragModel !== "constant" || spec.constantCd !== undefined, {
    message: "constantCd is required when dragModel is 'constant'",
    path: ["constantCd"],
  });
