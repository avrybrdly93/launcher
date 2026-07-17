import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioNondimensionalGroups } from "./scenario-metadata.js";
import type { EnvironmentSpec, ScenarioSpec } from "./scenario-spec.js";

const SMOOTH_SPHERE = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;
const NO_WIND_ENV: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: {},
  wind: { kind: "zero" },
};

function findPreset(projectileId: string): ScenarioSpec {
  return PRESET_SCENARIOS.find((p) => p.projectile.id === projectileId)!;
}

describe("scenarioNondimensionalGroups", () => {
  it("Π(shot put) < 0.1 < Π(table-tennis ball)", () => {
    const piShotPut = scenarioNondimensionalGroups(findPreset("shot-put")).pi;
    const piTableTennis = scenarioNondimensionalGroups(findPreset("table-tennis-ball")).pi;

    expect(piShotPut).toBeLessThan(0.1);
    expect(piTableTennis).toBeGreaterThan(0.1);
  });

  it("every preset yields finite, non-negative groups", () => {
    for (const preset of PRESET_SCENARIOS) {
      const groups = scenarioNondimensionalGroups(preset);
      for (const value of Object.values(groups)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has a nonzero spin ratio only for the golf-drive (Magnus) preset", () => {
    for (const preset of PRESET_SCENARIOS) {
      const { spinRatio } = scenarioNondimensionalGroups(preset);
      if (preset.projectile.id === "golf-ball") {
        expect(spinRatio).toBeGreaterThan(0);
      } else {
        expect(spinRatio).toBe(0);
      }
    }
  });

  it("is all-zero for a scenario launched from rest (v0 = 0)", () => {
    const atRest: ScenarioSpec = {
      schemaVersion: 1,
      model: { id: "planar-projectile", forceIds: ["gravity"] },
      projectile: SMOOTH_SPHERE,
      initialConditions: { x0: 0, y0: 10, vx0: 0, vy0: 0 },
      environment: NO_WIND_ENV,
      solver: { stepper: "rk45", maxSteps: 1000 },
      seed: 0,
    };
    expect(scenarioNondimensionalGroups(atRest)).toEqual({
      pi: 0,
      reynolds: 0,
      mach: 0,
      spinRatio: 0,
    });
  });
});
