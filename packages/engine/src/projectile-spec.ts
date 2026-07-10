import { z } from "zod";
import { ConstantCd, TabulatedReynoldsCd, type DragCoefficientModel } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient, type LiftCoefficientModel } from "./lift-coefficient.js";
import { createSphericalProjectileParams, type ProjectileParams } from "./projectile-params.js";
import { SchemaValidationError } from "./schema.js";

/** Serializable description of a `DragCoefficientModel` (§3.3). */
export const DragModelSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), cd: z.number().positive() }),
  z.object({ kind: z.literal("tabulated-reynolds-smooth-sphere") }),
]);
export type DragModelSpec = z.infer<typeof DragModelSpecSchema>;

/** Serializable description of a `LiftCoefficientModel` (§3.6). */
export const LiftModelSpecSchema = z.object({
  kind: z.literal("saturating"),
  maxCl: z.number().positive().optional(),
  slope: z.number().positive().optional(),
});
export type LiftModelSpec = z.infer<typeof LiftModelSpecSchema>;

/**
 * Serializable projectile record (§3.9): (m, R, Cd-model, Cl-model, tau_omega,
 * provenance). Spin itself is a per-shot initial condition (ScenarioSpec,
 * §2.3), not a static property of the object, so it isn't a field here —
 * `spinDecayTau` is the object's spin-relaxation timescale (§3.6), which
 * *is* intrinsic to the projectile.
 */
export const ProjectileSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mass: z.number().positive(),
  radius: z.number().positive(),
  dragModel: DragModelSpecSchema,
  liftModel: LiftModelSpecSchema.optional(),
  spinDecayTau: z.number().positive().optional(),
  provenance: z.string().min(1),
});
export type ProjectileSpec = z.infer<typeof ProjectileSpecSchema>;

function resolveDragModel(spec: DragModelSpec): DragCoefficientModel {
  switch (spec.kind) {
    case "constant":
      return new ConstantCd(spec.cd);
    case "tabulated-reynolds-smooth-sphere":
      return new TabulatedReynoldsCd();
  }
}

function resolveLiftModel(spec: LiftModelSpec): LiftCoefficientModel {
  return new SaturatingLiftCoefficient(spec.maxCl, spec.slope);
}

/** Builds the runtime `ProjectileParams` (live model objects) a `ProjectileSpec` describes. */
export function resolveProjectileParams(spec: ProjectileSpec, spin?: number): ProjectileParams {
  return createSphericalProjectileParams({
    mass: spec.mass,
    radius: spec.radius,
    dragCoefficient: resolveDragModel(spec.dragModel),
    liftCoefficient: spec.liftModel ? resolveLiftModel(spec.liftModel) : undefined,
    spin,
  });
}

/**
 * The asset loader (§3.9): validates a raw (untyped — e.g. parsed JSON)
 * array of projectile records against `ProjectileSpecSchema`, run at
 * build/import time so a corrupt asset fails loudly there instead of
 * surfacing as a silent NaN somewhere downstream in a simulation. Every
 * invalid entry is collected into one error (not just the first) so a
 * single fix-and-rerun catches everything.
 */
export function loadProjectileAssets(raw: readonly unknown[]): readonly ProjectileSpec[] {
  const specs: ProjectileSpec[] = [];
  const failures: string[] = [];

  raw.forEach((entry, index) => {
    const result = ProjectileSpecSchema.safeParse(entry);
    if (result.success) {
      specs.push(result.data);
      return;
    }
    const label =
      entry !== null && typeof entry === "object" && "id" in entry
        ? String((entry as { id: unknown }).id)
        : `index ${index}`;
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    failures.push(`asset "${label}" (index ${index}): ${detail}`);
  });

  if (failures.length > 0) {
    throw new SchemaValidationError(
      `Invalid projectile asset(s) — ${failures.length} of ${raw.length} failed validation: ${failures.join(" | ")}`,
      [],
    );
  }

  return specs;
}
