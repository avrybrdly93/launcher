import { describe, expect, it } from "vitest";
import { ANALYSIS_PACKAGE } from "./index.js";

describe("@ballista/analysis package skeleton", () => {
  it("exposes its package identity", () => {
    expect(ANALYSIS_PACKAGE).toBe("@ballista/analysis");
  });
});
