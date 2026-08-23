/**
 * `UncertainScenarioSpec` -- a nominal scenario plus the statement of what
 * about it is uncertain (P6.02, blueprint §7 phase 6, §9.3).
 *
 * The shape is deliberately "base spec, unchanged, plus overlays". A study is
 * a {@link ScenarioSpec} exactly as the deterministic engine already accepts
 * it, an ordered list of scalar parameters to vary, the replicate count `N`,
 * and the study's own seed. Nothing about the base is rewritten to make it
 * uncertain, which is what lets the same scenario be run deterministically and
 * as a study without two sources of truth for the physics -- and what makes
 * "validates against base schema" (this task's criterion) a property of the
 * type rather than a convention.
 *
 * Overlays are an **array**, not a `Record<path, DistributionSpec>`. The
 * ordering is load-bearing: P6.03 assigns each uncertain parameter its own
 * PCG32 substream by index, and P6.05 requires statistics to reduce in a
 * fixed order regardless of how a worker pool partitioned the batch. An array
 * makes that index explicit and stable across a JSON round trip. A keyed
 * object would leave it resting on property-order, which is a language
 * detail rather than a promise. Duplicate paths are rejected for the same
 * reason: two distributions on one parameter has no defined meaning, and
 * silently letting the last one win would make a study's result depend on
 * key order.
 *
 * A path is a dotted address into the base spec (`"projectile.mass"`,
 * `"initialConditions.vx0"`, `"environment.gravity.g0"`). It must resolve, in
 * *this* study's base, to a finite number -- checked at parse time by
 * {@link uncertainScenarioSpecSchema}, so a typo is a configuration error
 * with a path in the message rather than a `NaN` that surfaces ten thousand
 * replicates later as a quietly wrong mean.
 *
 * What this module deliberately does not do: turn a replicate index into a
 * concrete `ScenarioSpec`. Drawing the values and writing them back is
 * P6.03's replicate generator. This module owns the description and its
 * validation, and exports {@link readSpecNumberAtPath} so P6.03 has the same
 * path semantics rather than a second implementation of them.
 */

import { z } from "zod";
import { distributionSpecSchema, type DistributionSpec } from "./distribution.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";

/**
 * A dotted path into a {@link ScenarioSpec}, e.g. `"projectile.mass"`.
 *
 * Segments are plain object keys. Array indices are not supported: no numeric
 * field addressable this way currently lives inside an array, and admitting
 * `"...table.3.cd"` would mean deciding what an overlay on a tabulated drag
 * curve is supposed to mean -- a modelling question, not a schema one. A
 * numeric-looking segment is therefore just a key, and will fail to resolve.
 */
export const overlayPathSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/,
    "path must be dot-separated identifiers, e.g. 'projectile.mass'",
  );

/** One uncertain scalar: where it lives in the base spec, and how it varies. */
export const parameterOverlaySchema = z.object({
  /** Dotted address of the scalar in the base {@link ScenarioSpec}. */
  path: overlayPathSchema,
  /** The distribution that parameter is drawn from (P6.01). */
  distribution: distributionSpecSchema,
});
/** Parsed type of {@link parameterOverlaySchema}. */
export type ParameterOverlay = z.infer<typeof parameterOverlaySchema>;

/**
 * Reads the number at a dotted path in a spec.
 *
 * Returns `undefined` when the path does not resolve or does not land on a
 * finite number, so callers distinguish "absent" from a legitimate `0`
 * without a sentinel. Prototype keys are refused: a path is data, and a study
 * loaded from a URL or a file must not be able to address `__proto__`.
 *
 * Exported so P6.03's replicate generator resolves paths the same way this
 * schema validates them -- one definition of what a path means, not two that
 * can drift.
 */
export function readSpecNumberAtPath(spec: ScenarioSpec, path: string): number | undefined {
  let current: unknown = spec;
  for (const segment of path.split(".")) {
    if (segment === "__proto__" || segment === "constructor" || segment === "prototype") {
      return undefined;
    }
    if (typeof current !== "object" || current === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

/**
 * The unvalidated shape. Cross-field checks (paths resolve, no duplicates)
 * live in {@link uncertainScenarioSpecSchema}'s refinement, which is the
 * schema callers should use; this one exists so the refinement has something
 * to attach to.
 */
export const uncertainScenarioSpecUnrefinedSchema = z.object({
  schemaVersion: z.literal(1),
  /**
   * The nominal scenario. Parsed by the *base* schema, unmodified -- so a
   * study can never describe a scenario the deterministic engine could not
   * run, and a base spec that stops validating stops the study too.
   */
  base: scenarioSpecSchema,
  /**
   * Uncertain parameters, in substream order (P6.03). May be empty: a study
   * with no overlays and stochastic wind in the base is a legitimate
   * degenerate case (P6.16), and rejecting it here would push that check into
   * every caller.
   */
  overlays: z.array(parameterOverlaySchema),
  /**
   * Replicate count `N` (§9.3's `\hat Q_N`). Positive integer; the estimator's
   * standard error is only defined for `N >= 1`, and P6.07 measures the
   * `N^{-1/2}` law by varying it.
   */
  replicates: z.number().int().positive(),
  /**
   * The study's seed. Distinct from `base.seed`, which seeds the base
   * scenario's own stochastic elements (the frozen-OU wind path, ADR-011).
   * Two seeds because they answer different questions: `base.seed` fixes the
   * nominal realization, this one fixes the ensemble. P6.03 derives each
   * replicate's substreams from this value and the replicate index, so a
   * study reproduces regardless of worker-pool size.
   */
  seed: z.number().int().nonnegative(),
});

/**
 * A Monte Carlo study: a base scenario, what varies about it, how many
 * replicates, and the seed that makes the whole thing reproducible.
 *
 * Beyond the field-level checks, parsing enforces two cross-field
 * invariants -- every overlay path resolves to a finite number *in this
 * base*, and no path appears twice.
 */
export const uncertainScenarioSpecSchema = uncertainScenarioSpecUnrefinedSchema.superRefine(
  (spec, ctx) => {
    const seen = new Map<string, number>();
    spec.overlays.forEach((overlay, index) => {
      const firstIndex = seen.get(overlay.path);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `duplicate overlay path "${overlay.path}" (also at overlays[${firstIndex}]); ` +
            "one parameter cannot carry two distributions",
          path: ["overlays", index, "path"],
        });
        return;
      }
      seen.set(overlay.path, index);

      if (readSpecNumberAtPath(spec.base, overlay.path) === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `overlay path "${overlay.path}" does not resolve to a finite number ` +
            "in this study's base scenario",
          path: ["overlays", index, "path"],
        });
      }
    });
  },
);

/** Parsed type of {@link uncertainScenarioSpecSchema}. */
export type UncertainScenarioSpec = z.infer<typeof uncertainScenarioSpecSchema>;

/**
 * The nominal values the overlays sit on top of, in overlay order.
 *
 * These are the study's centre of mass in the literal sense: the parameter
 * vector a zero-variance study would produce, and the natural baseline for
 * P6.17's first-order sensitivity comparison (`sigma_out ~ |dR/dmu| sigma_mu`
 * is evaluated *at* the nominal point). Safe to index in lockstep with
 * `overlays`, because parsing has already proved every path resolves.
 */
export function nominalOverlayValues(spec: UncertainScenarioSpec): number[] {
  return spec.overlays.map((overlay) => {
    const value = readSpecNumberAtPath(spec.base, overlay.path);
    /* c8 ignore next 5 -- unreachable: the schema refinement rejects any spec
       whose overlay path does not resolve, so a parsed spec cannot reach this
       branch. Kept as an assertion rather than a non-null assertion operator
       so a future edit that loosens the refinement fails loudly here instead
       of silently producing undefined in a numeric array. */
    if (value === undefined) {
      throw new Error(`overlay path "${overlay.path}" does not resolve; spec was not validated`);
    }
    return value;
  });
}

/** The distributions alone, in substream order (P6.03's input). */
export function overlayDistributions(spec: UncertainScenarioSpec): DistributionSpec[] {
  return spec.overlays.map((overlay) => overlay.distribution);
}
