import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS, referenceDimensionlessPi } from "./scenario-presets.js";
import { parseWithSchema } from "./schema.js";
import { scenarioSpecSchema } from "./scenario-spec.js";

describe("PRESET_SCENARIOS", () => {
  it("every preset parses against scenarioSpecSchema", () => {
    for (const preset of PRESET_SCENARIOS) {
      expect(() => parseWithSchema(scenarioSpecSchema, preset)).not.toThrow();
    }
  });

  it("every preset round-trips through JSON serialize/parse bit-equal", () => {
    for (const preset of PRESET_SCENARIOS) {
      const roundTripped = parseWithSchema(scenarioSpecSchema, JSON.parse(JSON.stringify(preset)));
      expect(roundTripped).toEqual(preset);
    }
  });

  it("spans at least 3 decades of the dimensionless group Π across the set", () => {
    const piValues = PRESET_SCENARIOS.map((preset) =>
      referenceDimensionlessPi(
        preset.projectile,
        Math.hypot(preset.initialConditions.vx0, preset.initialConditions.vy0),
      ),
    );

    for (const pi of piValues) {
      expect(Number.isFinite(pi)).toBe(true);
      expect(pi).toBeGreaterThan(0);
    }

    const minPi = Math.min(...piValues);
    const maxPi = Math.max(...piValues);
    expect(Math.log10(maxPi / minPi)).toBeGreaterThanOrEqual(3);
  });

  it("puts the shot put at the low end and the dust grain at the high end of Π", () => {
    const shotPut = PRESET_SCENARIOS.find((p) => p.projectile.id === "shot-put")!;
    const dustGrain = PRESET_SCENARIOS.find((p) => p.projectile.id === "dust-grain")!;

    const piShotPut = referenceDimensionlessPi(
      shotPut.projectile,
      Math.hypot(shotPut.initialConditions.vx0, shotPut.initialConditions.vy0),
    );
    const piDustGrain = referenceDimensionlessPi(
      dustGrain.projectile,
      Math.hypot(dustGrain.initialConditions.vx0, dustGrain.initialConditions.vy0),
    );

    expect(piShotPut).toBeLessThan(0.1);
    expect(piDustGrain).toBeGreaterThan(10);
  });
});
