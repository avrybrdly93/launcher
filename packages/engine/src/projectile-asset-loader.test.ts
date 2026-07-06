import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { PROJECTILE_ASSETS, GOLF_BALL, SMOOTH_SPHERE } from "./projectile-assets.js";
import {
  loadProjectileParams,
  loadProjectileSpec,
  resolveProjectileParams,
} from "./projectile-asset-loader.js";

describe("loadProjectileSpec", () => {
  it("rejects a corrupt fixture with a useful error", () => {
    const corrupt = { id: "bad", name: "Bad", mass: -1, radius: 0.05, provenance: "" };
    let thrown: unknown;
    try {
      loadProjectileSpec(corrupt);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SchemaValidationError);
    const message = (thrown as SchemaValidationError).message;
    expect(message).toContain("mass");
  });

  it("rejects a 'constant' drag model missing constantCd with a useful error", () => {
    const corrupt = {
      id: "bad",
      name: "Bad",
      mass: 1,
      radius: 0.05,
      dragModel: "constant",
      provenance: "test fixture",
    };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileSpec(corrupt);
    } catch (e) {
      expect((e as SchemaValidationError).message).toContain("constantCd");
    }
  });

  it("accepts every shipped asset unchanged", () => {
    for (const spec of PROJECTILE_ASSETS) {
      expect(loadProjectileSpec(spec)).toEqual(spec);
    }
  });
});

describe("resolveProjectileParams / loadProjectileParams", () => {
  it("resolves a constant-Cd spec into matching runtime params", () => {
    const params = resolveProjectileParams(GOLF_BALL);
    expect(params.mass).toBe(GOLF_BALL.mass);
    expect(params.radius).toBe(GOLF_BALL.radius);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.25);
    expect(params.liftCoefficient).toBeDefined();
  });

  it("resolves a tabulated-reynolds spec without a constantCd", () => {
    const params = resolveProjectileParams(SMOOTH_SPHERE);
    expect(params.dragCoefficient.cd(1e3, 0)).toBeCloseTo(0.47, 1);
    expect(params.liftCoefficient).toBeUndefined();
  });

  it("loadProjectileParams validates then resolves raw data in one step", () => {
    const params = loadProjectileParams(GOLF_BALL);
    expect(params.mass).toBe(GOLF_BALL.mass);
  });

  it("loadProjectileParams rejects corrupt raw data before resolving", () => {
    expect(() => loadProjectileParams({ id: "bad" })).toThrow(SchemaValidationError);
  });
});
