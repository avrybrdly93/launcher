import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { ALL_REGIME_TAGS, scenarioRegimeTags, type RegimeTag } from "./scenario-regime-tags.js";

function preset(projectileId: string) {
  const found = PRESET_SCENARIOS.find((s) => s.projectile.id === projectileId);
  if (!found) throw new Error(`expected preset "${projectileId}" in PRESET_SCENARIOS`);
  return found;
}

describe("scenarioRegimeTags (P3.33)", () => {
  it("tags the shot put low-pi (Π < 0.1, P1.38)", () => {
    expect(scenarioRegimeTags(preset("shot-put"))).toContain("low-pi");
    expect(scenarioRegimeTags(preset("shot-put"))).not.toContain("high-pi");
  });

  it("tags the table-tennis ball high-pi (Π > 0.1, P1.38)", () => {
    expect(scenarioRegimeTags(preset("table-tennis-ball"))).toContain("high-pi");
    expect(scenarioRegimeTags(preset("table-tennis-ball"))).not.toContain("low-pi");
  });

  it("tags the golf drive magnus (the only preset with a wired Magnus force)", () => {
    expect(scenarioRegimeTags(preset("golf-ball"))).toContain("magnus");
    for (const spec of PRESET_SCENARIOS) {
      if (spec.projectile.id !== "golf-ball") {
        expect(scenarioRegimeTags(spec)).not.toContain("magnus");
      }
    }
  });

  it("tags the dust grain stiff (matches recommendSolver's own stiff classification, P2.47)", () => {
    expect(scenarioRegimeTags(preset("dust-grain"))).toContain("stiff");
    for (const spec of PRESET_SCENARIOS) {
      if (spec.projectile.id !== "dust-grain") {
        expect(scenarioRegimeTags(spec)).not.toContain("stiff");
      }
    }
  });

  it("every preset gets exactly one of low-pi/high-pi, never both or neither", () => {
    for (const spec of PRESET_SCENARIOS) {
      const tags = scenarioRegimeTags(spec);
      const piTags = tags.filter((tag) => tag === "low-pi" || tag === "high-pi");
      expect(piTags).toHaveLength(1);
    }
  });

  it("every produced tag is one of ALL_REGIME_TAGS", () => {
    for (const spec of PRESET_SCENARIOS) {
      for (const tag of scenarioRegimeTags(spec)) {
        expect(ALL_REGIME_TAGS).toContain(tag as RegimeTag);
      }
    }
  });
});
