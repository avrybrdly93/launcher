import { describe, expect, it } from "vitest";
import {
  AssetLoadError,
  loadProjectileSpec,
  loadProjectileSpecFromJsonText,
} from "./asset-loader.js";
import { PROJECTILE_ASSETS } from "./projectile-spec.js";

describe("loadProjectileSpec", () => {
  it("loads every built-in asset back out of its own plain-object form", () => {
    for (const asset of PROJECTILE_ASSETS) {
      expect(loadProjectileSpec(asset.id, asset)).toEqual(asset);
    }
  });

  it("rejects a corrupt fixture (missing provenance) with a useful, source-labeled error (P1.26 validation)", () => {
    const corrupt = {
      id: "broken-ball",
      name: "Broken ball",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "constant", value: 0.47 },
      // provenance omitted
    };

    expect(() => loadProjectileSpec("broken-ball.json", corrupt)).toThrow(AssetLoadError);
    try {
      loadProjectileSpec("broken-ball.json", corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AssetLoadError);
      const loadErr = err as AssetLoadError;
      expect(loadErr.sourceName).toBe("broken-ball.json");
      expect(loadErr.message).toContain("broken-ball.json");
      expect(loadErr.message).toContain("provenance");
    }
  });

  it("rejects negative mass with a field-specific error message", () => {
    const corrupt = {
      id: "negative-mass",
      name: "Negative-mass ball",
      mass: -5,
      radius: 0.1,
      dragCoefficient: { kind: "constant", value: 0.47 },
      provenance: "test fixture",
    };

    try {
      loadProjectileSpec("negative-mass.json", corrupt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AssetLoadError);
      expect((err as AssetLoadError).message).toContain("mass");
    }
  });

  it("rejects an unrecognized dragCoefficient kind", () => {
    const corrupt = {
      id: "bad-drag",
      name: "Bad drag model",
      mass: 1,
      radius: 0.1,
      dragCoefficient: { kind: "quantum-tunneling" },
      provenance: "test fixture",
    };

    expect(() => loadProjectileSpec("bad-drag.json", corrupt)).toThrow(AssetLoadError);
  });
});

describe("loadProjectileSpecFromJsonText", () => {
  it("loads a well-formed JSON fixture", () => {
    const spec = PROJECTILE_ASSETS[0]!;
    const loaded = loadProjectileSpecFromJsonText(spec.id, JSON.stringify(spec));
    expect(loaded).toEqual(spec);
  });

  it("rejects syntactically invalid JSON with a useful error naming the source", () => {
    const notJson = "{ this is not valid json ";
    expect(() => loadProjectileSpecFromJsonText("corrupt.json", notJson)).toThrow(AssetLoadError);
    try {
      loadProjectileSpecFromJsonText("corrupt.json", notJson);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AssetLoadError);
      expect((err as AssetLoadError).message).toContain("corrupt.json");
      expect((err as AssetLoadError).message.toLowerCase()).toContain("json");
    }
  });

  it("rejects well-formed JSON that fails schema validation", () => {
    const semanticallyInvalidJson = JSON.stringify({ id: "x" }); // missing everything else
    expect(() =>
      loadProjectileSpecFromJsonText("incomplete.json", semanticallyInvalidJson),
    ).toThrow(AssetLoadError);
  });
});
