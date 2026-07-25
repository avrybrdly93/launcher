import { describe, expect, it } from "vitest";
import { checkPaletteColorblindSafety } from "@ballista/runtime";
import { DEFAULT_FORCE_GLYPH_COLORS } from "./force-glyphs.js";

describe("DEFAULT_FORCE_GLYPH_COLORS colorblind safety (P3.36 validation criterion: palette contrast checks pass)", () => {
  it("every pair (gravity/drag/magnus/buoyancy/resultant) stays distinguishable under normal vision and every simulated CVD", () => {
    // drag-linear and drag-quadratic intentionally share one color (a model
    // only ever wires one drag law at a time, so the two never render
    // together) -- dedupe before checking pairwise distinguishability so
    // that legitimate self-pair doesn't read as a confusable-color violation.
    const colors = [...new Set(Object.values(DEFAULT_FORCE_GLYPH_COLORS))];
    const result = checkPaletteColorblindSafety(colors);

    if (!result.safe) {
      const detail = result.violations
        .map((v) => `[${v.indexA},${v.indexB}] under ${v.vision}: ΔE=${v.deltaE.toFixed(2)}`)
        .join("\n");
      expect.fail(`DEFAULT_FORCE_GLYPH_COLORS has confusable pairs:\n${detail}`);
    }
    expect(result.safe).toBe(true);
  });
});
