import { describe, expect, it } from "vitest";
import { guidanceFor } from "./error-surface-logic.js";

const ALL_REASONS = [
  "step-size-underflow",
  "max-steps-exceeded",
  "non-finite-state",
  "event-localization-failure",
] as const;

describe("error-surface-logic: guidanceFor", () => {
  it("every SolveFailureReason has a non-empty, distinct title and actionable guidance", () => {
    const seenTitles = new Set<string>();
    for (const reason of ALL_REASONS) {
      const { title, guidance } = guidanceFor(reason);
      expect(title.length).toBeGreaterThan(0);
      expect(guidance.length).toBeGreaterThan(20);
      expect(seenTitles.has(title)).toBe(false);
      seenTitles.add(title);
    }
  });

  it("step-size-underflow guidance mentions concrete next steps (rtol/atol/h_min), not a generic message", () => {
    const { guidance } = guidanceFor("step-size-underflow");
    expect(guidance).toMatch(/rtol|atol|h_min/);
  });
});
