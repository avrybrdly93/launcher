import { describe, expect, it } from "vitest";
import { RUNTIME_PACKAGE } from "./index.js";

describe("@ballista/runtime package skeleton", () => {
  it("exposes its package identity", () => {
    expect(RUNTIME_PACKAGE).toBe("@ballista/runtime");
  });
});
