import { describe, expect, it } from "vitest";
import corruptNegativeMass from "./assets/__fixtures__/corrupt-negative-mass.json";
import golfBall from "./assets/golf-ball.json";
import { loadProjectileSpec, loadProjectileSpecs } from "./asset-loader.js";
import { SchemaValidationError } from "./schema.js";

describe("loadProjectileSpec (P1.26: build-time schema validation)", () => {
  it("loads a well-formed fixture into a validated ProjectileSpec", () => {
    const spec = loadProjectileSpec(golfBall, "golf-ball.json");
    expect(spec.id).toBe("golf-ball");
    expect(spec.mass).toBeGreaterThan(0);
    expect(spec.provenance.length).toBeGreaterThan(0);
  });

  it("rejects a corrupt fixture (negative mass, missing provenance) with a useful, source-labeled error", () => {
    expect(() => loadProjectileSpec(corruptNegativeMass, "corrupt-negative-mass.json")).toThrow(
      SchemaValidationError,
    );

    try {
      loadProjectileSpec(corruptNegativeMass, "corrupt-negative-mass.json");
      expect.unreachable("expected loadProjectileSpec to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const message = (err as SchemaValidationError).message;
      // Useful == names the offending fixture and every violated field.
      expect(message).toContain("corrupt-negative-mass.json");
      expect(message).toContain("mass");
      expect(message).toContain("provenance");
    }
  });

  it("loadProjectileSpecs fails on the first invalid entry in a batch", () => {
    expect(() =>
      loadProjectileSpecs([
        { label: "golf-ball.json", data: golfBall },
        { label: "corrupt-negative-mass.json", data: corruptNegativeMass },
      ]),
    ).toThrow(/corrupt-negative-mass\.json/);
  });
});
