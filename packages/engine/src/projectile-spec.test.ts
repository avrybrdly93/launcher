import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import { parseProjectileSpec, resolveProjectileSpec } from "./projectile-spec.js";

describe("projectileSpecSchema", () => {
  const valid = {
    id: "test-sphere",
    name: "Test sphere",
    mass: 1,
    radius: 0.1,
    dragCoefficient: { kind: "constant", value: 0.47 },
    provenance: "unit test fixture",
  };

  it("parses a well-formed spec", () => {
    const spec = parseProjectileSpec(valid);
    expect(spec).toEqual(valid);
  });

  it("resolves into runtime ProjectileParams with a working drag coefficient", () => {
    const spec = parseProjectileSpec(valid);
    const params = resolveProjectileSpec(spec);
    expect(params.mass).toBe(1);
    expect(params.radius).toBe(0.1);
    expect(params.area).toBeCloseTo(Math.PI * 0.01, 12);
    expect(params.dragCoefficient.cd(1e5, 0.1)).toBe(0.47);
  });

  it("resolves the tabulated-reynolds-smooth-sphere kind to a Re-varying Cd", () => {
    const spec = parseProjectileSpec({
      ...valid,
      dragCoefficient: { kind: "tabulated-reynolds-smooth-sphere" },
    });
    const params = resolveProjectileSpec(spec);
    // Drag crisis: Cd at Re=3e5 is markedly lower than at Re=1e3 (SMOOTH_SPHERE_CD_TABLE).
    expect(params.dragCoefficient.cd(3e5, 0)).toBeLessThan(params.dragCoefficient.cd(1e3, 0));
  });

  it.each([
    ["missing provenance", { ...valid, provenance: "" }],
    ["negative mass", { ...valid, mass: -1 }],
    ["zero radius", { ...valid, radius: 0 }],
    ["unknown drag coefficient kind", { ...valid, dragCoefficient: { kind: "bogus" } }],
    ["missing drag coefficient", { ...valid, dragCoefficient: undefined }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseProjectileSpec(data)).toThrow(SchemaValidationError);
  });
});
