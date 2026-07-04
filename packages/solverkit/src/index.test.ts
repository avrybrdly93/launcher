import { describe, expect, it } from "vitest";
import { SOLVERKIT_PACKAGE } from "./index.js";

describe("@ballista/solverkit package skeleton", () => {
  it("exposes its package identity", () => {
    expect(SOLVERKIT_PACKAGE).toBe("@ballista/solverkit");
  });
});
