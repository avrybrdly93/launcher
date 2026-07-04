import { describe, expect, it } from "vitest";
import { VIZ_PACKAGE } from "./index.js";

describe("@ballista/viz package skeleton", () => {
  it("exposes its package identity", () => {
    expect(VIZ_PACKAGE).toBe("@ballista/viz");
  });
});
