import { describe, expect, it } from "vitest";
import { VALIDATION_PACKAGE } from "./index.js";

describe("@ballista/validation package skeleton", () => {
  it("exposes its package identity", () => {
    expect(VALIDATION_PACKAGE).toBe("@ballista/validation");
  });
});
