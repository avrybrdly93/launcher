import { describe, expect, it } from "vitest";
import { ProjectileSpecSchema } from "./projectile-spec.js";

describe("ProjectileSpecSchema (P1.25)", () => {
  it("accepts a minimal valid spec (constant Cd, no lift/spin)", () => {
    const result = ProjectileSpecSchema.safeParse({
      id: "test-sphere",
      displayName: "Test Sphere",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "unit test fixture",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a tabulated-Reynolds Cd model", () => {
    const result = ProjectileSpecSchema.safeParse({
      id: "test-tabulated",
      displayName: "Test Tabulated",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "tabulated-reynolds", re: [1e2, 1e5], cd: [1.1, 0.5] },
      provenance: "unit test fixture",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive mass", () => {
    const result = ProjectileSpecSchema.safeParse({
      id: "bad",
      displayName: "Bad",
      mass: 0,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "unit test fixture",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing provenance field", () => {
    const result = ProjectileSpecSchema.safeParse({
      id: "bad",
      displayName: "Bad",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "constant", value: 0.47 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown dragCoefficient kind", () => {
    const result = ProjectileSpecSchema.safeParse({
      id: "bad",
      displayName: "Bad",
      mass: 1,
      radius: 0.05,
      dragCoefficient: { kind: "made-up", value: 0.47 },
      provenance: "unit test fixture",
    });
    expect(result.success).toBe(false);
  });
});
