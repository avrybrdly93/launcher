import { describe, expect, it } from "vitest";
import {
  ALL_CVD_KINDS,
  ALL_VISION_KINDS,
  checkPaletteColorblindSafety,
  labUnderVision,
} from "./colorblind-safety.js";
import { COMPARE_PALETTE } from "./compare-store.js";

describe("checkPaletteColorblindSafety: sanity (the simulator itself is discriminating)", () => {
  it("flags an olive/rust pair engineered onto the protanopia confusion line -- clearly distinct normally, confusable under protanopia specifically (not deuteranopia, a different confusion line)", () => {
    // #967830 (olive) and #be4430 (rust) differ mainly along R vs G in a
    // ratio close to the protanopia simulation matrix's near-null
    // direction (its 2x2 R/G submatrix has determinant ~0.008, i.e. it's
    // close to rank-1): pure red and pure green stay far apart in
    // *lightness* even to a dichromat, so they're a poor sanity pair (see
    // /tmp exploration); this pair isolates the actual hue-confusion axis.
    const result = checkPaletteColorblindSafety(["#967830", "#be4430"]);

    expect(result.safe).toBe(false);
    const flaggedVisions = new Set(result.violations.map((v) => v.vision));
    expect(flaggedVisions.has("protanopia")).toBe(true);
    expect(flaggedVisions.has("normal")).toBe(false);
  });

  it("passes a single-color 'palette' trivially (no pairs to compare)", () => {
    const result = checkPaletteColorblindSafety(["#123456"]);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("black and white are distinguishable under every simulated vision", () => {
    const result = checkPaletteColorblindSafety(["#000000", "#ffffff"]);
    expect(result.safe).toBe(true);
  });

  it("checks every vision in ALL_VISION_KINDS (normal + all 3 CVD kinds)", () => {
    expect(ALL_VISION_KINDS).toEqual(["normal", ...ALL_CVD_KINDS]);
    expect(ALL_CVD_KINDS).toEqual(["protanopia", "deuteranopia", "tritanopia"]);
  });
});

describe("checkPaletteColorblindSafety: COMPARE_PALETTE (P3.36 validation criterion: palette contrast checks pass)", () => {
  it("every pair stays distinguishable under normal vision and every simulated CVD", () => {
    const result = checkPaletteColorblindSafety(COMPARE_PALETTE);

    if (!result.safe) {
      const detail = result.violations
        .map((v) => `[${v.indexA},${v.indexB}] under ${v.vision}: ΔE=${v.deltaE.toFixed(2)}`)
        .join("\n");
      expect.fail(`COMPARE_PALETTE has confusable pairs:\n${detail}`);
    }
    expect(result.safe).toBe(true);
  });

  it("has 8 distinct entries (one per compare-store slot)", () => {
    expect(new Set(COMPARE_PALETTE)).toHaveProperty("size", 8);
  });
});

describe("labUnderVision", () => {
  it("returns the unmodified color's Lab lightness for 'normal' vision (white is near-maximal L*)", () => {
    const [l] = labUnderVision("#ffffff", "normal");
    expect(l).toBeCloseTo(100, 0);
  });

  it("black has L*=0 regardless of simulated vision (no chroma to distort)", () => {
    for (const vision of ALL_VISION_KINDS) {
      const [l] = labUnderVision("#000000", vision);
      expect(l).toBeCloseTo(0, 3);
    }
  });
});
