import { describe, expect, it } from "vitest";
import { loadAssets } from "./asset-loader.js";
import { SchemaValidationError } from "./schema.js";
import { ProjectileSpecSchema, PROJECTILE_ASSETS } from "./projectile-spec.js";

describe("loadAssets", () => {
  it("validates a well-formed asset list and returns typed data", () => {
    const raw = [
      {
        id: "test-ball",
        label: "Test ball",
        mass: 1,
        radius: 0.1,
        dragCoefficient: 0.47,
        provenance: "fixture",
      },
    ];
    const loaded = loadAssets(ProjectileSpecSchema, raw, "test fixture");
    expect(loaded).toEqual(raw);
  });

  it("rejects a corrupt fixture with a useful error naming the asset and the bad field", () => {
    const corrupt = [
      {
        id: "good-ball",
        label: "Good ball",
        mass: 1,
        radius: 0.1,
        dragCoefficient: 0.47,
        provenance: "fixture",
      },
      {
        id: "bad-ball",
        label: "Bad ball",
        mass: -1, // invalid: must be positive
        radius: 0.1,
        dragCoefficient: 0.47,
        provenance: "", // invalid: must be non-empty
      },
    ];

    let thrown: unknown;
    try {
      loadAssets(ProjectileSpecSchema, corrupt, "corrupt fixture");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SchemaValidationError);
    const message = (thrown as SchemaValidationError).message;
    expect(message).toContain("bad-ball");
    expect(message).toContain("mass");
    expect(message).toContain("provenance");
    expect(message).not.toContain("good-ball:");
  });

  it("the built-in PROJECTILE_ASSETS module already passed loadAssets at import time", () => {
    expect(PROJECTILE_ASSETS.length).toBe(7);
  });
});
