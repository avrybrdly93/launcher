import { describe, expect, it } from "vitest";
import {
  BOUNDARY_ULPS,
  classifyMiss,
  gradeAgainstKey,
  type AnswerKey,
} from "./exercise-grading.js";

function key(solution: number, tolerance: number): AnswerKey {
  return {
    quantity: "test quantity",
    unit: "m",
    solution,
    tolerance,
    toleranceNote: "test",
  };
}

describe("gradeAgainstKey", () => {
  it("accepts the exact solution", () => {
    const graded = gradeAgainstKey(key(11.3, 0.05), 11.3);
    expect(graded.correct).toBe(true);
    expect(graded.error).toBe(0);
    expect(graded.nonFinite).toBe(false);
  });

  it("accepts an answer comfortably inside the tolerance", () => {
    expect(gradeAgainstKey(key(11.3, 0.05), 11.33).correct).toBe(true);
  });

  it("rejects an answer comfortably outside the tolerance", () => {
    expect(gradeAgainstKey(key(11.3, 0.05), 11.4).correct).toBe(false);
  });

  /**
   * The case the whole ulp argument exists for. `solution + tolerance` is a
   * rounded double whose distance back from `solution` is not exactly
   * `tolerance`, so a naive `error <= tolerance` grades the published boundary
   * as a miss. These two assertions are the evidence, not the claim: the first
   * shows the excess is real and non-zero, the second shows grading absorbs it.
   */
  it("accepts an answer sitting exactly on the stated boundary", () => {
    for (const [solution, tolerance] of [
      [11.299324111396446, 0.05],
      [2.2894558547524175, 0.02],
      [4.283062415096723, 0.05],
      [18.90031076438649, 0.05],
    ] as const) {
      const k = key(solution, tolerance);
      for (const boundary of [solution + tolerance, solution - tolerance]) {
        expect(gradeAgainstKey(k, boundary).correct).toBe(true);
      }
    }
  });

  it("the boundary really is unrepresentable, so the slack is not decorative", () => {
    // At least one of the published keys must actually overshoot, or the test
    // above would pass for the wrong reason.
    const overshoots = [
      [11.299324111396446, 0.05],
      [2.2894558547524175, 0.02],
      [4.283062415096723, 0.05],
      [18.90031076438649, 0.05],
    ].filter(([solution, tolerance]) => Math.abs(solution! + tolerance! - solution!) > tolerance!);
    expect(overshoots.length).toBeGreaterThan(0);
  });

  it("rejects an answer one ulp past what the slack can cover", () => {
    const solution = 11.299324111396446;
    const tolerance = 0.05;
    const slack =
      BOUNDARY_ULPS * Number.EPSILON * Math.max(Math.abs(solution), Math.abs(solution), tolerance);
    // Well past the slack but still absurdly close to the boundary: this is the
    // proof the slack is a representation correction and not a widened tolerance.
    const past = solution + tolerance + 100 * slack;
    expect(gradeAgainstKey(key(solution, tolerance), past).correct).toBe(false);
  });

  it("the slack is negligible next to the tolerance it protects", () => {
    const solution = 11.299324111396446;
    const tolerance = 0.05;
    const slack = BOUNDARY_ULPS * Number.EPSILON * Math.max(Math.abs(solution), tolerance);
    expect(slack).toBeLessThan(tolerance * 1e-12);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "grades %p as wrong rather than throwing",
    (submitted) => {
      const graded = gradeAgainstKey(key(11.3, 0.05), submitted);
      expect(graded.correct).toBe(false);
      expect(graded.nonFinite).toBe(true);
      expect(Number.isNaN(graded.error)).toBe(true);
    },
  );

  it("reports the key's own tolerance back, so a caller cannot display a different one", () => {
    expect(gradeAgainstKey(key(11.3, 0.05), 99).tolerance).toBe(0.05);
    expect(gradeAgainstKey(key(11.3, 0.05), 99).expected).toBe(11.3);
  });
});

describe("classifyMiss", () => {
  it("names the side the submission fell on", () => {
    expect(classifyMiss(key(10, 1), 12).direction).toBe("high");
    expect(classifyMiss(key(10, 1), 8).direction).toBe("low");
  });

  it("separates a precision miss from a method miss", () => {
    expect(classifyMiss(key(10, 1), 11.5).scale).toBe("just outside");
    expect(classifyMiss(key(10, 1), 13).scale).toBe("outside");
    expect(classifyMiss(key(10, 1), 30).scale).toBe("well outside");
  });

  it("puts the band edges on the wide side, so a borderline miss is never overstated", () => {
    expect(classifyMiss(key(10, 1), 12).scale).toBe("just outside");
    expect(classifyMiss(key(10, 1), 20).scale).toBe("outside");
  });
});
