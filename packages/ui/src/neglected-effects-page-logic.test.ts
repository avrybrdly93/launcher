import { describe, expect, it } from "vitest";
import { formatRatioAsPercent } from "./neglected-effects-page-logic.js";

describe("formatRatioAsPercent", () => {
  it("renders the soccer-ball buoyancy ratio to one decimal place", () => {
    expect(formatRatioAsPercent(0.0159)).toBe("1.6%");
  });

  it("rounds down when the second decimal is below 5", () => {
    expect(formatRatioAsPercent(0.0142)).toBe("1.4%");
  });

  it("renders zero as 0.0%", () => {
    expect(formatRatioAsPercent(0)).toBe("0.0%");
  });
});
