import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import {
  loadProjectileSpec,
  loadProjectileSpecs,
  projectileParamsFromSpec,
  VALIDATED_PROJECTILE_ASSETS,
} from "./projectile-asset-loader.js";

describe("projectile asset loader", () => {
  it("loads every real PROJECTILE_ASSETS entry without error", () => {
    expect(VALIDATED_PROJECTILE_ASSETS).toHaveLength(PROJECTILE_ASSETS.length);
    expect(loadProjectileSpecs(PROJECTILE_ASSETS)).toHaveLength(PROJECTILE_ASSETS.length);
  });

  it("rejects a corrupt fixture (negative mass, empty provenance) with a useful error", () => {
    const corrupt = {
      id: "broken",
      displayName: "Broken asset",
      mass: -5,
      radius: 0.05,
      dragModel: { kind: "constant", value: 0.47 },
      liftModel: { kind: "none" },
      provenance: "",
    };

    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);

    let caught: unknown;
    try {
      loadProjectileSpec(corrupt);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SchemaValidationError);
    const message = (caught as SchemaValidationError).message;
    expect(message).toContain("mass");
    expect(message).toContain("provenance");
  });

  it("rejects a corrupt entry inside a list with the offending index in the message", () => {
    const data: unknown[] = [
      PROJECTILE_ASSETS[0],
      { ...PROJECTILE_ASSETS[1], dragModel: { kind: "not-a-real-model" } },
    ];

    let caught: unknown;
    try {
      loadProjectileSpecs(data);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SchemaValidationError);
    expect((caught as SchemaValidationError).message).toContain("asset[1]");
  });

  it("projectileParamsFromSpec builds live params matching the spec's drag model", () => {
    const golf = VALIDATED_PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    const params = projectileParamsFromSpec(golf);
    expect(params.mass).toBe(golf.mass);
    expect(params.radius).toBe(golf.radius);
    expect(params.dragCoefficient.cd(0, 0)).toBeCloseTo(0.25, 12);
    expect(params.liftCoefficient).toBeDefined();
  });
});
