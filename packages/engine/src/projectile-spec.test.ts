import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "./schema.js";
import {
  PROJECTILE_ASSETS,
  ProjectileSpecSchema,
  loadProjectileAssets,
} from "./projectile-spec.js";

describe("PROJECTILE_ASSETS", () => {
  it("covers the §3.9 asset list: sphere, golf, soccer, baseball, TT ball, cannonball, shot put", () => {
    const ids = PROJECTILE_ASSETS.map((a) => a.id).sort();
    expect(ids).toEqual(
      ["baseball", "cannonball", "golf", "shot-put", "soccer", "sphere", "table-tennis"].sort(),
    );
  });

  it("is already validated eagerly at module-load time (P1.26: build-time validation)", () => {
    // PROJECTILE_ASSETS is the *output* of loadProjectileAssets, computed at
    // import time -- re-loading it here should be a pure no-op round trip.
    const reloaded = loadProjectileAssets(PROJECTILE_ASSETS);
    expect(reloaded).toEqual(PROJECTILE_ASSETS);
  });

  it("gives every asset a non-empty provenance string", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(typeof asset.provenance).toBe("string");
      expect(asset.provenance.length).toBeGreaterThan(0);
    }
  });

  it("gives every numeric datum (mass, radius, and constant Cd) a citation", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass.citation.length).toBeGreaterThan(0);
      expect(asset.radius.citation.length).toBeGreaterThan(0);
      const drag = asset.dragCoefficient;
      const citation = drag.kind === "constant" ? drag.cd.citation : drag.citation;
      expect(citation.length).toBeGreaterThan(0);
    }
  });

  it("has physically positive mass and radius for every asset", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(asset.mass.value).toBeGreaterThan(0);
      expect(asset.radius.value).toBeGreaterThan(0);
    }
  });
});

describe("ProjectileSpecSchema", () => {
  it("rejects a spec missing a citation", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1 }, // missing citation
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "constant", cd: { value: 0.47, citation: "test" } },
      provenance: "test",
    };
    expect(() => ProjectileSpecSchema.parse(corrupt)).toThrow();
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects an unknown drag-coefficient kind", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1, citation: "test" },
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "quadratic-fit" },
      provenance: "test",
    };
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("rejects an empty provenance string", () => {
    const corrupt = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1, citation: "test" },
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "tabulated-reynolds", citation: "test" },
      provenance: "",
    };
    expect(() => loadProjectileAssets([corrupt])).toThrow(SchemaValidationError);
  });

  it("reports a useful, multi-issue error message pointing at every corrupt field", () => {
    const corruptFixture = {
      id: "bad",
      name: "Bad asset",
      mass: { value: 1 }, // missing citation
      radius: { value: 0.05, citation: "test" },
      dragCoefficient: { kind: "constant", cd: { value: "not-a-number", citation: "test" } },
      provenance: "test",
    };

    expect(() => loadProjectileAssets([corruptFixture])).toThrow(SchemaValidationError);
    try {
      loadProjectileAssets([corruptFixture]);
      expect.fail("expected loadProjectileAssets to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const message = (err as InstanceType<typeof SchemaValidationError>).message;
      // Useful == points at the actual broken fields, not just "invalid".
      expect(message).toContain("mass.citation");
      expect(message).toContain("dragCoefficient.cd.value");
    }
  });
});
