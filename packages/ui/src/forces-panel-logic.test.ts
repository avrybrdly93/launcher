import { describe, expect, it } from "vitest";
import { KNOWN_FORCE_IDS } from "@ballista/runtime";
import type { ForceGlyphSet } from "@ballista/viz";
import {
  badgeMagnitude,
  FORCE_LABELS,
  FORCE_TOGGLES,
  toggleForceId,
} from "./forces-panel-logic.js";

describe("FORCE_TOGGLES", () => {
  it("has one entry per KNOWN_FORCE_IDS, in the same order", () => {
    expect(FORCE_TOGGLES.map((t) => t.id)).toEqual(KNOWN_FORCE_IDS);
  });

  it("every known force id has its own (non-fallback) label", () => {
    for (const id of KNOWN_FORCE_IDS) {
      expect(FORCE_LABELS[id]).toBeDefined();
      expect(FORCE_LABELS[id]).not.toBe(id);
    }
  });
});

describe("toggleForceId", () => {
  it("appends an absent id", () => {
    expect(toggleForceId(["gravity"], "buoyancy")).toEqual(["gravity", "buoyancy"]);
  });

  it("removes a present id when others remain", () => {
    expect(toggleForceId(["gravity", "buoyancy"], "buoyancy")).toEqual(["gravity"]);
  });

  it("is a no-op when removing the last remaining id (forceIds must stay non-empty)", () => {
    expect(toggleForceId(["gravity"], "gravity")).toEqual(["gravity"]);
  });

  it("does not mutate the input array", () => {
    const input = ["gravity"];
    toggleForceId(input, "buoyancy");
    expect(input).toEqual(["gravity"]);
  });
});

describe("badgeMagnitude", () => {
  const glyphSet: ForceGlyphSet = {
    forces: [
      { id: "gravity", fx: 0, fy: -9.8, magnitude: 9.8 },
      { id: "drag-quadratic", fx: -1.5, fy: 0, magnitude: 1.5 },
    ],
    resultant: { id: "resultant", fx: -1.5, fy: -9.8, magnitude: 9.914 },
  };

  it("returns the matching glyph's magnitude", () => {
    expect(badgeMagnitude(glyphSet, "gravity")).toBe(9.8);
    expect(badgeMagnitude(glyphSet, "drag-quadratic")).toBe(1.5);
  });

  it("returns undefined for a force not currently wired", () => {
    expect(badgeMagnitude(glyphSet, "magnus")).toBeUndefined();
  });

  it("returns undefined when there is no glyph set yet (no result)", () => {
    expect(badgeMagnitude(undefined, "gravity")).toBeUndefined();
  });
});
