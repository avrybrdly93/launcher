import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import { projectileSpecSchema } from "./projectile-spec.js";
import { PROJECTILE_ASSETS } from "./projectile-assets.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers sphere, golf, soccer, baseball, table-tennis, cannonball, shot put", () => {
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

  it("every asset validates against projectileSpecSchema", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(() => parseWithSchema(projectileSpecSchema, asset)).not.toThrow();
    }
  });

  it("every asset has a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("rejects a corrupt record (negative mass) with a useful error", () => {
    const corrupt = { ...PROJECTILE_ASSETS[0]!, mass: -1 };
    expect(() => parseWithSchema(projectileSpecSchema, corrupt)).toThrow(/mass/);
  });

  it("rejects a record missing provenance", () => {
    const withoutProvenance: Record<string, unknown> = { ...PROJECTILE_ASSETS[0]! };
    delete withoutProvenance["provenance"];
    expect(() => parseWithSchema(projectileSpecSchema, withoutProvenance)).toThrow(/provenance/);
  });
});
