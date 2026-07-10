import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { loadProjectileAssets, PROJECTILE_ASSETS } from "./projectile-spec.js";

describe("loadProjectileAssets (P1.26 asset loader)", () => {
  it("round-trips the built-in library unchanged", () => {
    const loaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(loaded).toEqual(PROJECTILE_ASSETS);
  });

  it("rejects a corrupt fixture with a useful error naming the asset and the bad field", () => {
    const corrupt = [
      PROJECTILE_ASSETS[0],
      { ...PROJECTILE_ASSETS[1], mass: -1 }, // golf-ball, negative mass
    ];

    let thrown: unknown;
    try {
      loadProjectileAssets(corrupt);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(SchemaValidationError);
    const message = (thrown as SchemaValidationError).message;
    expect(message).toContain("golf-ball");
    expect(message).toContain("position 1");
    expect(message).toContain("mass");
  });

  it("rejects a fixture missing provenance, identifying it even without an id", () => {
    const corrupt = [
      { id: "x", name: "x", mass: 1, radius: 1, dragModel: { kind: "constant", cd: 0.5 } },
    ];
    expect(() => loadProjectileAssets(corrupt)).toThrow(/provenance/);
  });

  it("labels an entry with no id as such rather than crashing on the labeler itself", () => {
    const corrupt = [{ mass: -1 }];
    expect(() => loadProjectileAssets(corrupt)).toThrow(/\(missing id\)/);
  });

  it("stops at the first bad entry and never returns a partially-invalid array", () => {
    const corrupt = [PROJECTILE_ASSETS[0], { bogus: true }, PROJECTILE_ASSETS[1]];
    expect(() => loadProjectileAssets(corrupt)).toThrow(SchemaValidationError);
  });
});
