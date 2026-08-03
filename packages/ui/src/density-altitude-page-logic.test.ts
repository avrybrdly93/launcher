import { describe, expect, it } from "vitest";
import { formatDensity, formatRangeIncrease } from "./density-altitude-page-logic.js";

describe("formatDensity", () => {
  it("renders ISA sea-level density to three decimal places", () => {
    expect(formatDensity(1.2250122659906946)).toBe("1.225 kg/m³");
  });
});

describe("formatRangeIncrease", () => {
  it("renders a positive range increase with a leading plus sign on both figures", () => {
    expect(formatRangeIncrease(1.62, 2.03)).toBe("+1.6 m (+2.0%)");
  });

  it("renders zero without a plus sign artifact issue (still labeled +0.0)", () => {
    expect(formatRangeIncrease(0, 0)).toBe("+0.0 m (+0.0%)");
  });

  it("renders a negative range increase without a plus sign", () => {
    expect(formatRangeIncrease(-1.2, -1.5)).toBe("-1.2 m (-1.5%)");
  });
});
