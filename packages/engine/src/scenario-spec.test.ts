import { describe, expect, it } from "vitest";
import { EnvSample } from "./env-sample.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { parseWithSchema, SchemaValidationError } from "./schema.js";
import {
  environmentSpecToEnvironment,
  scenarioSpecSchema,
  type EnvironmentSpec,
  type ScenarioSpec,
} from "./scenario-spec.js";

const PROJECTILE = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;

function baseScenario(environment: EnvironmentSpec): ScenarioSpec {
  return {
    schemaVersion: 1,
    model: { id: "planar-projectile", forceIds: ["gravity", "drag-quadratic"] },
    projectile: PROJECTILE,
    initialConditions: { x0: 0, y0: 1.5, vx0: 30, vy0: 20 },
    environment,
    solver: { stepper: "rk45", rtol: 1e-6, atol: 1e-9, maxSteps: 10000, controller: "PI" },
    seed: 42,
  };
}

const ENVIRONMENT_VARIANTS: readonly EnvironmentSpec[] = [
  {
    atmosphere: { kind: "constant" },
    gravity: {},
    wind: { kind: "zero" },
  },
  {
    atmosphere: { kind: "exponential", rho0: 1.225, T0: 288.15, p0: 101325, scaleHeight: 8500 },
    gravity: { g0: 9.81, altitudeDependent: true },
    wind: { kind: "uniform", wx: 5, wy: -0.5 },
  },
  {
    atmosphere: { kind: "constant" },
    gravity: {},
    wind: { kind: "log-profile", frictionVelocity: 0.4, roughnessLength: 0.03, wy: 0 },
  },
  {
    atmosphere: { kind: "constant" },
    gravity: {},
    wind: { kind: "sinusoidal-gust", mean: 2, amplitude: 1, angularFrequency: 0.5, phase: 0.1 },
  },
  {
    atmosphere: { kind: "constant" },
    gravity: {},
    wind: { kind: "gaussian-vortex", circulation: 10, coreRadius: 2, centerX: 5, centerY: 5 },
  },
  {
    atmosphere: { kind: "constant" },
    gravity: {},
    wind: {
      kind: "gridded",
      grid: { x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 2, wx: [0, 1, 2, 3], wy: [0, 0, 0, 0] },
    },
  },
];

describe("scenarioSpecSchema", () => {
  it("round-trips every environment variant through JSON serialize/parse bit-equal", () => {
    for (const environment of ENVIRONMENT_VARIANTS) {
      const original = baseScenario(environment);
      const roundTripped = parseWithSchema(
        scenarioSpecSchema,
        JSON.parse(JSON.stringify(original)),
      );
      expect(roundTripped).toEqual(original);
    }
  });

  it("rejects a schemaVersion other than 1", () => {
    const corrupt = { ...baseScenario(ENVIRONMENT_VARIANTS[0]!), schemaVersion: 2 };
    expect(() => parseWithSchema(scenarioSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects a model with no forceIds", () => {
    const corrupt = {
      ...baseScenario(ENVIRONMENT_VARIANTS[0]!),
      model: { id: "planar-projectile", forceIds: [] },
    };
    expect(() => parseWithSchema(scenarioSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects a negative seed", () => {
    const corrupt = { ...baseScenario(ENVIRONMENT_VARIANTS[0]!), seed: -1 };
    expect(() => parseWithSchema(scenarioSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects a non-positive maxSteps", () => {
    const corrupt = {
      ...baseScenario(ENVIRONMENT_VARIANTS[0]!),
      solver: { stepper: "rk45", maxSteps: 0 },
    };
    expect(() => parseWithSchema(scenarioSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects an unrecognized wind kind", () => {
    const corrupt = {
      ...baseScenario(ENVIRONMENT_VARIANTS[0]!),
      environment: { atmosphere: { kind: "constant" }, gravity: {}, wind: { kind: "tornado" } },
    };
    expect(() => parseWithSchema(scenarioSpecSchema, corrupt)).toThrow(SchemaValidationError);
  });
});

describe("environmentSpecToEnvironment", () => {
  it("builds a live Environment that samples finite values for every wind variant", () => {
    for (const environment of ENVIRONMENT_VARIANTS) {
      const env = environmentSpecToEnvironment(environment);
      const out = new EnvSample();
      env.sample(0, 1, 1, out);
      expect(Number.isFinite(out.rho)).toBe(true);
      expect(Number.isFinite(out.g)).toBe(true);
      expect(Number.isFinite(out.wx)).toBe(true);
      expect(Number.isFinite(out.wy)).toBe(true);
    }
  });
});
