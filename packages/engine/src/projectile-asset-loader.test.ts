import { describe, expect, it } from "vitest";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import {
  loadProjectileSpec,
  loadProjectileSpecs,
  projectileParamsFromSpec,
  VALIDATED_PROJECTILE_ASSETS,
} from "./projectile-asset-loader.js";
import { SchemaValidationError } from "./schema.js";

describe("loadProjectileSpec", () => {
  it("accepts every asset in the library unchanged", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(loadProjectileSpec(asset)).toEqual(asset);
    }
  });

  it("rejects a corrupt fixture (negative radius) with a useful, field-referencing error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, radius: -0.05 };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    expect(() => loadProjectileSpec(corrupt)).toThrow(/radius/);
  });

  it("rejects a fixture with an unknown dragCoefficient kind", () => {
    const corrupt = {
      ...PROJECTILE_ASSETS[0]!,
      dragCoefficient: { kind: "warp-drive", value: 1 },
    };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
  });

  it("rejects a non-object fixture", () => {
    expect(() => loadProjectileSpec("not a spec")).toThrow(SchemaValidationError);
    expect(() => loadProjectileSpec(null)).toThrow(SchemaValidationError);
  });
});

describe("loadProjectileSpecs", () => {
  it("throws on the first invalid entry in a batch", () => {
    const batch = [PROJECTILE_ASSETS[0]!, { ...PROJECTILE_ASSETS[1]!, mass: -1 }];
    expect(() => loadProjectileSpecs(batch)).toThrow(SchemaValidationError);
  });
});

describe("VALIDATED_PROJECTILE_ASSETS", () => {
  it("is the full asset library, validated at module load (build time)", () => {
    expect(VALIDATED_PROJECTILE_ASSETS).toEqual(PROJECTILE_ASSETS);
  });
});

describe("projectileParamsFromSpec", () => {
  it("materializes a constant-Cd spec into live ProjectileParams", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "baseball")!;
    const params = projectileParamsFromSpec(spec);
    expect(params.mass).toBe(spec.mass);
    expect(params.radius).toBe(spec.radius);
    expect(params.area).toBeCloseTo(Math.PI * spec.radius * spec.radius, 15);
    expect(params.dragCoefficient).toBeInstanceOf(ConstantCd);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.3);
    expect(params.liftCoefficient).toBeUndefined();
  });

  it("materializes a tabulated-Reynolds Cd spec", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;
    const params = projectileParamsFromSpec(spec);
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
  });

  it("materializes a lift-coefficient spec when present (golf ball)", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    const params = projectileParamsFromSpec(spec);
    expect(params.liftCoefficient).toBeInstanceOf(SaturatingLiftCoefficient);
    expect(params.liftCoefficient!.cl(1)).toBeCloseTo(0.6, 15);
  });
});
