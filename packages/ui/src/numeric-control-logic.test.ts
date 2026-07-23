import { describe, expect, it } from "vitest";
import { clampToRange, nudgeStep, nudgeValue, type NumericRange } from "./numeric-control-logic.js";

describe("clampToRange", () => {
  it("passes an in-range value through unchanged", () => {
    expect(clampToRange(5, { min: 0, max: 10 })).toBe(5);
  });

  it("clamps below min and above max", () => {
    expect(clampToRange(-5, { min: 0, max: 10 })).toBe(0);
    expect(clampToRange(15, { min: 0, max: 10 })).toBe(10);
  });

  it("leaves a side unclamped when that bound is missing", () => {
    expect(clampToRange(-1000, { max: 10 })).toBe(-1000);
    expect(clampToRange(1000, { min: 0 })).toBe(1000);
    expect(clampToRange(42, {})).toBe(42);
  });
});

describe("nudgeStep", () => {
  it("defaults to a step of 1 when the range declares none", () => {
    expect(nudgeStep({}, false)).toBe(1);
  });

  it("uses the range's own declared step", () => {
    expect(nudgeStep({ step: 0.5 }, false)).toBe(0.5);
  });

  it("divides the step by 10 when fine (shift held)", () => {
    expect(nudgeStep({ step: 0.5 }, true)).toBeCloseTo(0.05, 12);
    expect(nudgeStep({}, true)).toBeCloseTo(0.1, 12);
  });
});

describe("nudgeValue: shift-fine works (P3.19 validation criterion)", () => {
  const range: NumericRange = { min: 0, max: 150, step: 0.1 };

  it("nudges up/down by the full step when not fine", () => {
    expect(nudgeValue(50, range, 1, false)).toBeCloseTo(50.1, 12);
    expect(nudgeValue(50, range, -1, false)).toBeCloseTo(49.9, 12);
  });

  it("nudges by a tenth of the step when fine (shift held)", () => {
    expect(nudgeValue(50, range, 1, true)).toBeCloseTo(50.01, 12);
    expect(nudgeValue(50, range, -1, true)).toBeCloseTo(49.99, 12);
  });

  it("a fine nudge is a strictly smaller move than a normal one, in the same direction", () => {
    const normal = nudgeValue(50, range, 1, false) - 50;
    const fine = nudgeValue(50, range, 1, true) - 50;
    expect(fine).toBeGreaterThan(0);
    expect(fine).toBeLessThan(normal);
  });
});

describe("nudgeValue: values clamp to schema ranges (P3.19 validation criterion)", () => {
  const range: NumericRange = { min: 0, max: 90, step: 1 };

  it("nudging past the max clamps to max instead of overshooting", () => {
    expect(nudgeValue(89.5, range, 1, false)).toBe(90);
    expect(nudgeValue(90, range, 1, false)).toBe(90);
  });

  it("nudging past the min clamps to min instead of undershooting", () => {
    expect(nudgeValue(0.5, range, -1, false)).toBe(0);
    expect(nudgeValue(0, range, -1, false)).toBe(0);
  });

  it("repeated nudges at the edge stay pinned, never escaping the range", () => {
    let value = 90;
    for (let i = 0; i < 10; i++) {
      value = nudgeValue(value, range, 1, i % 2 === 0);
    }
    expect(value).toBe(90);
  });
});
