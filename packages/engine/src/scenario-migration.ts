import { z } from "zod";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";

/** The `schemaVersion` a freshly-built `ScenarioSpec` carries (§5.2). */
export const CURRENT_SCENARIO_SCHEMA_VERSION = 1;

const versionEnvelopeSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
});

/** A pure function migrating a raw scenario object forward by exactly one schema version. */
export type ScenarioMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of forward migrations keyed by *source* version: `MIGRATIONS[v]` produces the
 * v+1 shape from the v shape. Ballista's real history has never shipped a v0 -- v1 is the
 * first schema version ever released -- so `migrateV0ToV1` exists only as a worked example
 * that exercises the chain mechanism end-to-end (§5.2: "a small chain of pure migration
 * functions, each tested"), verified against a fabricated v0 fixture. The current version
 * (1) requires no entry: `migrateScenarioSpec` treats "already at CURRENT" as the identity
 * migration and validates directly.
 */
const MIGRATIONS: Readonly<Record<number, ScenarioMigration>> = {
  0: migrateV0ToV1,
};

/** Example migration: v0 predates the seed field (P0.11 seeded PRNG); default to seed 0. */
function migrateV0ToV1(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, schemaVersion: 1, seed: raw.seed ?? 0 };
}

/**
 * Migrates an arbitrary raw scenario payload forward to `CURRENT_SCENARIO_SCHEMA_VERSION`
 * by walking `MIGRATIONS` one step at a time, then validates the result against
 * `scenarioSpecSchema`. A payload already at the current version passes through untouched
 * (the identity case); a payload newer than the current version is rejected rather than
 * silently misinterpreted.
 */
export function migrateScenarioSpec(raw: unknown): ScenarioSpec {
  const { schemaVersion } = parseWithSchema(versionEnvelopeSchema, raw);
  if (schemaVersion > CURRENT_SCENARIO_SCHEMA_VERSION) {
    throw new SchemaValidationError(
      `Scenario schemaVersion ${schemaVersion} is newer than the supported version ` +
        `${CURRENT_SCENARIO_SCHEMA_VERSION}`,
      [],
    );
  }

  let current = raw as Record<string, unknown>;
  let version = schemaVersion;
  while (version < CURRENT_SCENARIO_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new SchemaValidationError(
        `No migration registered from schemaVersion ${version} to ${version + 1}`,
        [],
      );
    }
    current = migrate(current);
    version += 1;
  }

  return parseWithSchema(scenarioSpecSchema, current);
}
