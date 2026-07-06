import { describe, expect, it } from "vitest";
import {
  loadProjectileSpec,
  loadProjectileSpecs,
  resolveProjectileParams,
  VALIDATED_PROJECTILE_ASSETS,
} from "./asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { SchemaValidationError } from "./schema.js";
import { TabulatedReynoldsCd } from "./drag-coefficient.js";

describe("asset loader (P1.26)", () => {
  it("VALIDATED_PROJECTILE_ASSETS validates all bundled assets at build time (module load)", () => {
    expect(VALIDATED_PROJECTILE_ASSETS).toEqual(PROJECTILE_ASSETS);
  });

  it("rejects a corrupt fixture with a useful, actionable error message", () => {
    const corrupt = { id: "bad", name: "Bad", mass: -1, radius: 0.1 };
    expect(() => loadProjectileSpec(corrupt)).toThrow(SchemaValidationError);
    try {
      loadProjectileSpec(corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const message = (err as SchemaValidationError).message;
      // useful means it names the offending field(s), not just "invalid".
      expect(message).toContain("mass");
      expect(message).toContain("dragCoefficient");
      expect(message).toContain("provenance");
    }
  });

  it("tags a corrupt entry within a batch with its index", () => {
    const batch = [PROJECTILE_ASSETS[0], { id: "bad" }, PROJECTILE_ASSETS[1]];
    expect(() => loadProjectileSpecs(batch)).toThrow(/index 1/);
  });

  it("resolveProjectileParams builds live ProjectileParams matching the spec's mass/radius/area", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "baseball")!;
    const params = resolveProjectileParams(spec);
    expect(params.mass).toBe(spec.mass);
    expect(params.radius).toBe(spec.radius);
    expect(params.area).toBeCloseTo(Math.PI * spec.radius * spec.radius, 15);
    expect(params.dragCoefficient.cd(0, 0)).toBe(0.3);
  });

  it("resolves a tabulated-reynolds drag spec to a TabulatedReynoldsCd instance", () => {
    const spec = {
      ...PROJECTILE_ASSETS[0]!,
      dragCoefficient: { kind: "tabulated-reynolds" as const },
    };
    const params = resolveProjectileParams(spec);
    expect(params.dragCoefficient).toBeInstanceOf(TabulatedReynoldsCd);
  });

  it("resolves an omitted liftCoefficient to undefined (no Magnus contribution)", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "smooth-sphere")!;
    expect(spec.liftCoefficient).toBeUndefined();
    const params = resolveProjectileParams(spec);
    expect(params.liftCoefficient).toBeUndefined();
  });

  it("resolves a declared liftCoefficient (golf ball) to a working Magnus lift model", () => {
    const spec = PROJECTILE_ASSETS.find((a) => a.id === "golf-ball")!;
    const params = resolveProjectileParams(spec);
    expect(params.liftCoefficient).toBeDefined();
    expect(params.liftCoefficient!.cl(1)).toBeCloseTo(0.6, 15); // saturates at maxCl
  });
});
