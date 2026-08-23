import { describe, expect, it } from "vitest";
import { distributionSpecSchema, type DistributionSpec } from "./distribution.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioSpecSchema, type ScenarioSpec } from "./scenario-spec.js";
import {
  nominalOverlayValues,
  overlayDistributions,
  overlayPathSchema,
  readSpecNumberAtPath,
  uncertainScenarioSpecSchema,
  type UncertainScenarioSpec,
} from "./uncertain-scenario-spec.js";

/**
 * A real preset rather than a hand-rolled literal, so "validates against base
 * schema" is tested against a scenario the deterministic engine actually
 * runs. A base invented for this test could drift from the real shape without
 * anything noticing.
 */
const BASE: ScenarioSpec = scenarioSpecSchema.parse(PRESET_SCENARIOS[0]);

const NORMAL: DistributionSpec = distributionSpecSchema.parse({
  kind: "normal",
  mean: 0.045,
  stdDev: 0.001,
});

const UNIFORM: DistributionSpec = distributionSpecSchema.parse({
  kind: "uniform",
  min: 20,
  max: 30,
});

function study(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    base: BASE,
    overlays: [{ path: "projectile.mass", distribution: NORMAL }],
    replicates: 1000,
    seed: 7,
    ...overrides,
  };
}

describe("overlayPathSchema", () => {
  it.each(["mass", "projectile.mass", "environment.gravity.g0", "_x.$y.z9"])(
    "accepts the dotted identifier path %s",
    (path) => {
      expect(overlayPathSchema.safeParse(path).success).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["leading dot", ".mass"],
    ["trailing dot", "projectile."],
    ["double dot", "projectile..mass"],
    ["array index", "projectile.dragModel.table.0.cd"],
    ["bracket syntax", "projectile['mass']"],
    ["segment starting with a digit", "projectile.0mass"],
  ])("rejects %s", (_label, path) => {
    expect(overlayPathSchema.safeParse(path).success).toBe(false);
  });
});

describe("readSpecNumberAtPath", () => {
  it("reads a top-level number", () => {
    expect(readSpecNumberAtPath(BASE, "seed")).toBe(BASE.seed);
  });

  it("reads a nested number", () => {
    expect(readSpecNumberAtPath(BASE, "projectile.mass")).toBe(BASE.projectile.mass);
  });

  it("returns undefined for a path that does not exist", () => {
    expect(readSpecNumberAtPath(BASE, "projectile.notAField")).toBeUndefined();
  });

  it("returns undefined when the path stops on a non-number", () => {
    // `projectile.name` is a string; an overlay on it is meaningless.
    expect(readSpecNumberAtPath(BASE, "projectile.name")).toBeUndefined();
  });

  it("returns undefined when the path stops on an object", () => {
    expect(readSpecNumberAtPath(BASE, "projectile")).toBeUndefined();
  });

  it("returns undefined when it descends through a non-object", () => {
    expect(readSpecNumberAtPath(BASE, "projectile.mass.somethingElse")).toBeUndefined();
  });

  it("distinguishes a legitimate zero from an absent field", () => {
    // The undefined/0 confusion is the whole reason this returns undefined
    // rather than NaN or 0: `x0` is genuinely 0 in most presets.
    const zeroed = scenarioSpecSchema.parse({
      ...BASE,
      initialConditions: { ...BASE.initialConditions, x0: 0 },
    });
    expect(readSpecNumberAtPath(zeroed, "initialConditions.x0")).toBe(0);
    expect(readSpecNumberAtPath(zeroed, "initialConditions.nope")).toBeUndefined();
  });

  it("refuses prototype keys", () => {
    // A path is data -- it can arrive from a shared URL or a loaded file --
    // so it must not be able to address the prototype chain.
    expect(readSpecNumberAtPath(BASE, "__proto__")).toBeUndefined();
    expect(readSpecNumberAtPath(BASE, "constructor")).toBeUndefined();
    expect(readSpecNumberAtPath(BASE, "projectile.constructor")).toBeUndefined();
  });

  it("does not read an inherited property", () => {
    expect(readSpecNumberAtPath(BASE, "toString")).toBeUndefined();
  });
});

describe("uncertainScenarioSpecSchema", () => {
  it("accepts a well-formed study", () => {
    expect(() => uncertainScenarioSpecSchema.parse(study())).not.toThrow();
  });

  it("accepts a study with no overlays", () => {
    // Degenerate but legitimate: the base's own stochastic wind (P6.16) is
    // uncertainty even with no parameter overlays.
    expect(() => uncertainScenarioSpecSchema.parse(study({ overlays: [] }))).not.toThrow();
  });

  it("accepts several overlays on different parameters", () => {
    const parsed = uncertainScenarioSpecSchema.parse(
      study({
        overlays: [
          { path: "projectile.mass", distribution: NORMAL },
          { path: "initialConditions.vx0", distribution: UNIFORM },
        ],
      }),
    );
    expect(parsed.overlays).toHaveLength(2);
  });

  describe("validates against the base schema", () => {
    it("rejects a base that is not a valid ScenarioSpec", () => {
      const broken = { ...BASE, projectile: { ...BASE.projectile, mass: -1 } };
      expect(() => uncertainScenarioSpecSchema.parse(study({ base: broken }))).toThrow();
    });

    it("rejects a base with the wrong schemaVersion", () => {
      const broken = { ...BASE, schemaVersion: 2 };
      expect(() => uncertainScenarioSpecSchema.parse(study({ base: broken }))).toThrow();
    });

    it("rejects a missing base outright", () => {
      const withoutBase = study();
      delete (withoutBase as Record<string, unknown>).base;
      expect(() => uncertainScenarioSpecSchema.parse(withoutBase)).toThrow();
    });

    it("reports the failure under the base path, not the study root", () => {
      const broken = { ...BASE, projectile: { ...BASE.projectile, mass: -1 } };
      const result = uncertainScenarioSpecSchema.safeParse(study({ base: broken }));
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path.slice(0, 2)).toEqual(["base", "projectile"]);
    });
  });

  describe("overlay paths", () => {
    it("rejects a path that does not resolve in the base", () => {
      const result = uncertainScenarioSpecSchema.safeParse(
        study({ overlays: [{ path: "projectile.notAField", distribution: NORMAL }] }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toContain("does not resolve to a finite number");
      expect(result.error.issues[0]?.path).toEqual(["overlays", 0, "path"]);
    });

    it("rejects a path that resolves to a non-number", () => {
      const result = uncertainScenarioSpecSchema.safeParse(
        study({ overlays: [{ path: "projectile.name", distribution: NORMAL }] }),
      );
      expect(result.success).toBe(false);
    });

    it("names the offending index when a later overlay is the bad one", () => {
      const result = uncertainScenarioSpecSchema.safeParse(
        study({
          overlays: [
            { path: "projectile.mass", distribution: NORMAL },
            { path: "nope.nothing", distribution: UNIFORM },
          ],
        }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["overlays", 1, "path"]);
    });

    it("rejects a duplicate path", () => {
      // Two distributions on one parameter has no defined meaning; letting
      // the last win would make the result depend on ordering.
      const result = uncertainScenarioSpecSchema.safeParse(
        study({
          overlays: [
            { path: "projectile.mass", distribution: NORMAL },
            { path: "projectile.mass", distribution: UNIFORM },
          ],
        }),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toContain("duplicate overlay path");
      expect(result.error.issues[0]?.message).toContain("overlays[0]");
    });

    it("rejects an invalid distribution inside an otherwise fine overlay", () => {
      expect(() =>
        uncertainScenarioSpecSchema.parse(
          study({
            overlays: [
              { path: "projectile.mass", distribution: { kind: "normal", mean: 1, stdDev: -1 } },
            ],
          }),
        ),
      ).toThrow();
    });
  });

  describe("replicates and seed", () => {
    it.each([0, -1, 1.5, Number.NaN])("rejects replicates = %s", (replicates) => {
      expect(() => uncertainScenarioSpecSchema.parse(study({ replicates }))).toThrow();
    });

    it("accepts a single replicate", () => {
      expect(() => uncertainScenarioSpecSchema.parse(study({ replicates: 1 }))).not.toThrow();
    });

    it.each([-1, 2.5])("rejects seed = %s", (seed) => {
      expect(() => uncertainScenarioSpecSchema.parse(study({ seed }))).toThrow();
    });

    it("accepts seed 0", () => {
      expect(() => uncertainScenarioSpecSchema.parse(study({ seed: 0 }))).not.toThrow();
    });

    it("keeps the study seed independent of the base seed", () => {
      // Two seeds answer different questions: base.seed fixes the nominal
      // realization (ADR-011 frozen wind), study seed fixes the ensemble.
      const parsed = uncertainScenarioSpecSchema.parse(study({ seed: 99 }));
      expect(parsed.seed).toBe(99);
      expect(parsed.base.seed).toBe(BASE.seed);
    });
  });
});

describe("serialize round-trip", () => {
  /** The task's validation criterion, stated directly. */
  function roundTrip(spec: UncertainScenarioSpec): UncertainScenarioSpec {
    return uncertainScenarioSpecSchema.parse(JSON.parse(JSON.stringify(spec)));
  }

  it("survives JSON round-trip unchanged", () => {
    const parsed = uncertainScenarioSpecSchema.parse(
      study({
        overlays: [
          { path: "projectile.mass", distribution: NORMAL },
          { path: "initialConditions.vx0", distribution: UNIFORM },
        ],
      }),
    );
    expect(roundTrip(parsed)).toEqual(parsed);
  });

  it("is stable under a second round trip", () => {
    const once = roundTrip(uncertainScenarioSpecSchema.parse(study()));
    expect(roundTrip(once)).toEqual(once);
  });

  it("serializes to identical JSON text on both passes", () => {
    // Deep equality would tolerate a reordering that the substream mapping
    // does not; comparing the text catches it.
    const parsed = uncertainScenarioSpecSchema.parse(
      study({
        overlays: [
          { path: "initialConditions.vx0", distribution: UNIFORM },
          { path: "projectile.mass", distribution: NORMAL },
        ],
      }),
    );
    expect(JSON.stringify(roundTrip(parsed))).toBe(JSON.stringify(parsed));
  });

  it("preserves overlay order, which the substream mapping depends on", () => {
    const parsed = uncertainScenarioSpecSchema.parse(
      study({
        overlays: [
          { path: "initialConditions.vx0", distribution: UNIFORM },
          { path: "projectile.mass", distribution: NORMAL },
        ],
      }),
    );
    expect(roundTrip(parsed).overlays.map((o) => o.path)).toEqual([
      "initialConditions.vx0",
      "projectile.mass",
    ]);
  });

  it("preserves a truncated distribution's bounds", () => {
    const truncated = distributionSpecSchema.parse({
      kind: "lognormal",
      logMean: 0,
      logStdDev: 0.25,
      min: 0.5,
      max: 2,
    });
    const parsed = uncertainScenarioSpecSchema.parse(
      study({ overlays: [{ path: "projectile.mass", distribution: truncated }] }),
    );
    expect(roundTrip(parsed).overlays[0]?.distribution).toEqual(truncated);
  });

  it("round-trips the empty-overlay study", () => {
    const parsed = uncertainScenarioSpecSchema.parse(study({ overlays: [] }));
    expect(roundTrip(parsed)).toEqual(parsed);
  });

  it("round-trips every preset as a base", () => {
    // The base is the half most likely to lose a field in serialization --
    // optional spin/lateral channels, nested wind variants, tabulated drag.
    for (const preset of PRESET_SCENARIOS) {
      const parsed = uncertainScenarioSpecSchema.parse({
        schemaVersion: 1,
        base: preset,
        overlays: [{ path: "projectile.mass", distribution: NORMAL }],
        replicates: 10,
        seed: 1,
      });
      expect(roundTrip(parsed)).toEqual(parsed);
      expect(roundTrip(parsed).base).toEqual(scenarioSpecSchema.parse(preset));
    }
  });
});

describe("nominalOverlayValues", () => {
  it("reads the base values in overlay order", () => {
    const parsed = uncertainScenarioSpecSchema.parse(
      study({
        overlays: [
          { path: "initialConditions.vx0", distribution: UNIFORM },
          { path: "projectile.mass", distribution: NORMAL },
        ],
      }),
    );
    expect(nominalOverlayValues(parsed)).toEqual([
      BASE.initialConditions.vx0,
      BASE.projectile.mass,
    ]);
  });

  it("is empty for a study with no overlays", () => {
    expect(
      nominalOverlayValues(uncertainScenarioSpecSchema.parse(study({ overlays: [] }))),
    ).toEqual([]);
  });
});

describe("overlayDistributions", () => {
  it("returns the distributions in substream order", () => {
    const parsed = uncertainScenarioSpecSchema.parse(
      study({
        overlays: [
          { path: "initialConditions.vx0", distribution: UNIFORM },
          { path: "projectile.mass", distribution: NORMAL },
        ],
      }),
    );
    expect(overlayDistributions(parsed)).toEqual([UNIFORM, NORMAL]);
  });
});
