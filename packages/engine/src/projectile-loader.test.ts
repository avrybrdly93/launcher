import { describe, expect, it } from "vitest";
import {
  loadProjectileParams,
  loadProjectileSpec,
  resolveProjectileParams,
} from "./projectile-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";

describe("loadProjectileParams", () => {
  it("resolves every built-in asset (round-tripped through JSON, as a build-time fixture would be) into usable ProjectileParams", () => {
    for (const asset of PROJECTILE_ASSETS) {
      const raw: unknown = JSON.parse(JSON.stringify(asset));
      const params = loadProjectileParams(raw);

      expect(params.mass).toBe(asset.mass);
      expect(params.radius).toBe(asset.radius);
      expect(params.area).toBeCloseTo(Math.PI * asset.radius * asset.radius, 12);
      expect(params.dragCoefficient.cd(0, 0)).toBeCloseTo(asset.dragCoefficient.cd, 12);

      if (asset.liftCoefficient) {
        expect(params.liftCoefficient).toBeDefined();
        expect(params.liftCoefficient!.cl(1)).toBeGreaterThan(0);
      } else {
        expect(params.liftCoefficient).toBeUndefined();
      }
    }
  });

  it("resolveProjectileParams produces a saturating lift model matching the spec's tuning", () => {
    const spec = loadProjectileSpec({
      id: "tuned",
      name: "Tuned ball",
      mass: 0.1,
      radius: 0.02,
      dragCoefficient: { kind: "constant", cd: 0.4 },
      liftCoefficient: { kind: "saturating", maxCl: 0.3, slope: 2 },
      provenance: "test fixture",
    });
    const params = resolveProjectileParams(spec);

    expect(params.liftCoefficient!.cl(1000)).toBeCloseTo(0.3, 12); // saturates at maxCl
    expect(params.liftCoefficient!.cl(0.01)).toBeCloseTo(0.02, 12); // 2 * 0.01, below saturation
  });

  it("rejects a corrupt fixture (negative radius) with a useful, field-level error", () => {
    let error: unknown;
    try {
      loadProjectileParams({
        id: "broken",
        name: "Broken",
        mass: 0.1,
        radius: -0.02,
        dragCoefficient: { kind: "constant", cd: 0.4 },
        provenance: "test fixture",
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(SchemaValidationError);
    expect((error as SchemaValidationError).message).toContain("radius");
  });

  it("rejects a fixture with a non-numeric mass", () => {
    expect(() =>
      loadProjectileParams({
        id: "broken",
        name: "Broken",
        mass: "not-a-number",
        radius: 0.02,
        dragCoefficient: { kind: "constant", cd: 0.4 },
        provenance: "test fixture",
      }),
    ).toThrow(SchemaValidationError);
  });
});
