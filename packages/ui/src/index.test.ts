import { describe, expect, it } from "vitest";
import { UI_PACKAGE } from "./index.js";

describe("@ballista/ui package skeleton", () => {
  it("exposes its package identity", () => {
    expect(UI_PACKAGE).toBe("@ballista/ui");
  });
});
