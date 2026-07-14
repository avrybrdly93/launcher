import { describe, expect, it } from "vitest";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";
import { projectileSpecSchema } from "./projectile-spec.js";
import { parseWithSchema } from "./schema.js";

describe("PROJECTILE_ASSETS", () => {
  it("ships the initial asset library named in §3.9", () => {
    expect(Object.keys(PROJECTILE_ASSETS).sort()).toEqual(
      [
        "smoothSphere",
        "golfBall",
        "soccerBall",
        "baseball",
        "tableTennisBall",
        "cannonball",
        "shotPut",
      ].sort(),
    );
  });

  it("every asset validates against projectileSpecSchema and has a non-empty provenance string", () => {
    for (const [key, spec] of Object.entries(PROJECTILE_ASSETS)) {
      const parsed = parseWithSchema(projectileSpecSchema, spec);
      expect(parsed, key).toEqual(spec);
      expect(typeof spec.provenance, key).toBe("string");
      expect(spec.provenance.length, key).toBeGreaterThan(0);
    }
  });

  it("every asset has a unique id", () => {
    const ids = Object.values(PROJECTILE_ASSETS).map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
