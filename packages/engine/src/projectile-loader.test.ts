import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { loadProjectileAssets } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

const VALID_FIXTURE = {
  id: "test-ball",
  name: "Test Ball",
  mass: 0.1,
  radius: 0.02,
  dragModel: { kind: "constant", cd: 0.4 },
  provenance: "unit test fixture",
};

describe("loadProjectileAssets (P1.26)", () => {
  it("accepts a well-formed fixture", () => {
    expect(loadProjectileAssets([VALID_FIXTURE])).toEqual([VALID_FIXTURE]);
  });

  it("loads the real PROJECTILE_ASSETS array without throwing (already self-validated at import)", () => {
    expect(() => loadProjectileAssets(PROJECTILE_ASSETS)).not.toThrow();
  });

  it("rejects a corrupt fixture (negative mass) with a useful error", () => {
    const corrupt = { ...VALID_FIXTURE, mass: -1 };
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
    expect(() => loadProjectileAssets([corrupt])).toThrow(/test-ball/);
    expect(() => loadProjectileAssets([corrupt])).toThrow(/mass/);
  });

  it("rejects a corrupt fixture (missing provenance) with a useful error", () => {
    const corrupt: Record<string, unknown> = { ...VALID_FIXTURE };
    delete corrupt.provenance;
    expect(() => loadProjectileAssets([corrupt])).toThrow(/provenance/);
  });

  it("rejects a corrupt fixture (unknown dragModel kind) with a useful error", () => {
    const corrupt = { ...VALID_FIXTURE, dragModel: { kind: "made-up" } };
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("reports every invalid entry, not just the first", () => {
    const corruptA = { ...VALID_FIXTURE, id: "bad-a", mass: -1 };
    const corruptB = { ...VALID_FIXTURE, id: "bad-b", radius: -1 };
    const load = (): unknown => loadProjectileAssets([corruptA, VALID_FIXTURE, corruptB]);
    expect(load).toThrow(/bad-a/);
    expect(load).toThrow(/bad-b/);
    expect(load).toThrow(/2 of 3/);
  });

  it("labels a corrupt entry with no readable id by its array index", () => {
    const corrupt = { mass: -1 };
    expect(() => loadProjectileAssets([corrupt])).toThrow(/index 0/);
  });
});
