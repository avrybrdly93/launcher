import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";
import { CURRENT_SCENARIO_SCHEMA_VERSION, migrateScenarioSpec } from "./scenario-migration.js";
import type { EnvironmentSpec, ScenarioSpec } from "./scenario-spec.js";

const PROJECTILE = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;

const ENVIRONMENT: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: {},
  wind: { kind: "zero" },
};

function v1Scenario(): ScenarioSpec {
  return {
    schemaVersion: 1,
    model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
    projectile: PROJECTILE,
    initialConditions: { x0: 0, y0: 1.5, vx0: 30, vy0: 20 },
    environment: ENVIRONMENT,
    solver: { stepper: "rk45", rtol: 1e-6, atol: 1e-9, maxSteps: 10000, controller: "PI" },
    seed: 42,
  };
}

function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...obj };
  delete copy[key];
  return copy as Omit<T, K>;
}

/** A fabricated v0 fixture: the shape `ScenarioSpec` had before the seed field existed. */
function v0Fixture(): Record<string, unknown> {
  return { ...omit(v1Scenario(), "seed"), schemaVersion: 0 };
}

describe("migrateScenarioSpec", () => {
  it("is the identity migration at the current schema version", () => {
    const original = v1Scenario();
    expect(migrateScenarioSpec(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it("migrates a fabricated v0 fixture forward and validates it", () => {
    const migrated = migrateScenarioSpec(v0Fixture());
    expect(migrated.schemaVersion).toBe(CURRENT_SCENARIO_SCHEMA_VERSION);
    expect(migrated.seed).toBe(0);
    expect(migrated).toEqual({ ...v1Scenario(), seed: 0 });
  });

  it("does not overwrite a seed already present on the v0 payload", () => {
    const fixture = { ...v0Fixture(), seed: 7 };
    const migrated = migrateScenarioSpec(fixture);
    expect(migrated.seed).toBe(7);
  });

  it("rejects a schemaVersion newer than the current version", () => {
    const fromTheFuture = { ...v1Scenario(), schemaVersion: 2 };
    expect(() => migrateScenarioSpec(fromTheFuture)).toThrow(SchemaValidationError);
  });

  it("rejects a payload with no schemaVersion field", () => {
    const withoutVersion = omit(v1Scenario(), "schemaVersion");
    expect(() => migrateScenarioSpec(withoutVersion)).toThrow(SchemaValidationError);
  });

  it("rejects a negative schemaVersion", () => {
    const orphaned = { ...v0Fixture(), schemaVersion: -1 };
    expect(() => migrateScenarioSpec(orphaned)).toThrow(SchemaValidationError);
  });
});
