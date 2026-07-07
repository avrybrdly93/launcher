import { describe, expect, it } from "vitest";
import { ConstantCd, TabulatedReynoldsCd } from "./drag-coefficient.js";
import { SaturatingLiftCoefficient } from "./lift-coefficient.js";
import {
  loadProjectileAsset,
  PROJECTILE_LIBRARY,
  projectileParamsFromSpec,
} from "./projectile-asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";

describe("projectileParamsFromSpec / loadProjectileAsset (P1.26)", () => {
  it("instantiates a ConstantCd drag model and derives area/volume from radius", () => {
    const params = projectileParamsFromSpec({
      name: "custom",
      mass: 2,
      radius: 0.1,
      dragCoefficient: { type: "constant", value: 0.4 },
      provenance: "test fixture",
    });
    expect(params.mass).toBe(2);
    expect(params.radius).toBe(0.1);
    expect(params.dragCoefficient).toBeInstanceOf(ConstantCd);
    expect(params.dragCoefficient.cd(1e4, 0)).toBe(0.4);
    expect(params.area).toBeCloseTo(Math.PI * 0.1 * 0.1, 15);
    expect(params.volume).toBeCloseTo((4 / 3) * Math.PI * 0.1 ** 3, 15);
    expect(params.liftCoefficient).toBeUndefined();
  });

  it("instantiates a TabulatedReynoldsCd drag model from a table spec", () => {
    const params = projectileParamsFromSpec({
      name: "custom-tabulated",
      mass: 1,
      radius: 0.05,
      dragCoefficient: {
        type: "tabulatedReynolds",
        table: { re: [1e2, 1e4], cd: [1.0, 0.5] },
      },
      provenance: "test fixture",
    });
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
  });

  it("instantiates a SaturatingLiftCoefficient when the spec declares one", () => {
    const params = projectileParamsFromSpec({
      name: "custom-with-lift",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { type: "constant", value: 0.47 },
      liftCoefficient: { type: "saturating", maxCl: 0.5, slope: 1.2 },
      provenance: "test fixture",
    });
    expect(params.liftCoefficient).toBeInstanceOf(SaturatingLiftCoefficient);
    expect(params.liftCoefficient?.cl(1)).toBeCloseTo(0.5, 15); // saturates: min(0.5, 1.2*1)
  });

  it("validates raw data before converting (loadProjectileAsset === parse + convert)", () => {
    const params = loadProjectileAsset({
      name: "raw",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { type: "constant", value: 0.47 },
      provenance: "test fixture",
    });
    expect(params.mass).toBe(1);
  });

  it("rejects a corrupt fixture with a useful error (P1.26 validation criterion)", () => {
    const corrupt = {
      name: "corrupt",
      mass: -5, // invalid: mass must be positive
      radius: 0.05,
      dragCoefficient: { type: "constant", value: 0.47 },
      provenance: "test fixture",
    };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileAsset(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const message = (err as SchemaValidationError).message;
      expect(message).toContain("mass");
    }
  });

  it("rejects a fixture with an unknown drag-coefficient type", () => {
    const corrupt = {
      name: "corrupt-drag",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { type: "not-a-real-model", value: 0.47 },
      provenance: "test fixture",
    };
    expect(() => loadProjectileAsset(corrupt)).toThrow(SchemaValidationError);
  });
});

describe("PROJECTILE_LIBRARY (build-time-validated asset library)", () => {
  it("eagerly loads every PROJECTILE_ASSETS entry, keyed by name", () => {
    expect(PROJECTILE_LIBRARY.size).toBe(PROJECTILE_ASSETS.length);
    for (const spec of PROJECTILE_ASSETS) {
      expect(PROJECTILE_LIBRARY.has(spec.name)).toBe(true);
      expect(PROJECTILE_LIBRARY.get(spec.name)?.mass).toBe(spec.mass);
    }
  });
});
