import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { recommendSolver } from "./solver-advisor.js";

function preset(id: string) {
  const found = PRESET_SCENARIOS.find((s) => s.projectile.id === id);
  if (!found) throw new Error(`expected preset "${id}" in PRESET_SCENARIOS`);
  return found;
}

describe("solver advisor (§4.10, P2.47)", () => {
  it("dust-grain (physically stiff, P1.36) triggers the stiff regime with a warning", () => {
    const recommendation = recommendSolver(preset("dust-grain"));
    expect(recommendation.regime).toBe("stiff");
    expect(recommendation.warning).toBeDefined();
    expect(recommendation.warning).toMatch(/stiff/i);
  });

  it("golf drive (drag + Magnus, not gravity-only) gets a DOPRI5 recommendation", () => {
    const recommendation = recommendSolver(preset("golf-ball"));
    expect(recommendation.regime).toBe("default-adaptive");
    expect(recommendation.recommendedStepperId).toBe("dopri5");
    expect(recommendation.warning).toBeUndefined();
  });

  it("the drag-free reference (gravity only) gets the conservation-focus/symplectic recommendation", () => {
    const recommendation = recommendSolver(preset("smooth-sphere"));
    expect(recommendation.regime).toBe("conservation-focus");
    expect(recommendation.recommendedStepperId).toBe("velocity-verlet");
  });

  it("no other preset in the library is spuriously flagged stiff", () => {
    const nonStiffIds = ["shot-put", "table-tennis-ball", "golf-ball", "baseball"];
    for (const id of nonStiffIds) {
      const recommendation = recommendSolver(preset(id));
      expect(recommendation.regime).not.toBe("stiff");
    }
  });
});
