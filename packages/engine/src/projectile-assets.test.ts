import { describe, expect, it } from "vitest";
import { projectileSpecSchema } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("has one entry each for sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    expect(PROJECTILE_ASSETS.map((a) => a.id).sort()).toEqual(
      [
        "baseball",
        "cannonball",
        "golf-ball",
        "shot-put",
        "smooth-sphere",
        "soccer-ball",
        "table-tennis-ball",
      ].sort(),
    );
  });

  it.each(PROJECTILE_ASSETS.map((asset) => [asset.id, asset] as const))(
    "%s validates against projectileSpecSchema and has a non-empty provenance string",
    (_id, asset) => {
      const parsed = projectileSpecSchema.parse(asset);
      expect(parsed.provenance.length).toBeGreaterThan(0);
      expect(parsed.mass).toBeGreaterThan(0);
      expect(parsed.radius).toBeGreaterThan(0);
    },
  );

  it("rejects a spec with an empty provenance string", () => {
    const bad = { ...PROJECTILE_ASSETS[0]!, provenance: "" };
    expect(projectileSpecSchema.safeParse(bad).success).toBe(false);
  });
});
