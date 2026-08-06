import { describe, expect, it } from "vitest";
import { parseWithSchema } from "./schema.js";
import {
  EXHIBIT_IDS,
  SCENARIO_LIBRARY,
  findCuratedScenario,
  type ExhibitId,
} from "./scenario-library.js";
import { scenarioNondimensionalGroups } from "./scenario-metadata.js";
import { PRESET_SCENARIOS } from "./scenario-presets.js";
import { scenarioRegimeTags } from "./scenario-regime-tags.js";
import { scenarioSpecSchema } from "./scenario-spec.js";

/**
 * P4.36's validation criterion is "each note links exhibit; CI validates all
 * specs". This file is the second half (every spec valid) plus the coverage
 * the "spanning regimes" wording asks for; `routes.test.ts` in the `app`
 * package is the first half (every exhibit link resolves to a real route),
 * and `scenario-library-resolve.test.ts` in `runtime` proves the specs are
 * not merely *parseable* but actually runnable.
 */
describe("SCENARIO_LIBRARY", () => {
  it("holds exactly the 20 curated scenarios P4.36 specifies", () => {
    expect(SCENARIO_LIBRARY).toHaveLength(20);
  });

  it("every spec parses against scenarioSpecSchema", () => {
    for (const entry of SCENARIO_LIBRARY) {
      expect(() => parseWithSchema(scenarioSpecSchema, entry.spec), entry.id).not.toThrow();
    }
  });

  it("every spec round-trips through JSON serialize/parse bit-equal", () => {
    for (const entry of SCENARIO_LIBRARY) {
      const roundTripped = parseWithSchema(
        scenarioSpecSchema,
        JSON.parse(JSON.stringify(entry.spec)),
      );
      expect(roundTripped, entry.id).toEqual(entry.spec);
    }
  });

  it("ids are unique and findCuratedScenario resolves each one", () => {
    const ids = SCENARIO_LIBRARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of SCENARIO_LIBRARY) {
      expect(findCuratedScenario(entry.id), entry.id).toBe(entry);
    }
    expect(findCuratedScenario("no-such-scenario")).toBeUndefined();
  });

  it("every entry carries a real teaching note and title, not a placeholder", () => {
    for (const entry of SCENARIO_LIBRARY) {
      expect(entry.title.trim().length, entry.id).toBeGreaterThan(0);
      // Long enough to be a sentence about the physics rather than a restated title.
      expect(entry.note.trim().length, entry.id).toBeGreaterThan(80);
      expect(entry.note, entry.id).not.toMatch(/TODO|TBD|FIXME|placeholder/i);
    }
  });

  it("every note links an exhibit id the library declares", () => {
    for (const entry of SCENARIO_LIBRARY) {
      expect(EXHIBIT_IDS, entry.id).toContain(entry.exhibit);
    }
  });

  it("every declared exhibit is reached by at least one entry (no orphan exhibit)", () => {
    const linked = new Set<ExhibitId>(SCENARIO_LIBRARY.map((entry) => entry.exhibit));
    for (const exhibit of EXHIBIT_IDS) {
      expect(linked, exhibit).toContain(exhibit);
    }
  });

  it("re-exports the seven P1.36 presets by reference, so the two lists cannot drift", () => {
    const specs = SCENARIO_LIBRARY.map((entry) => entry.spec);
    for (const preset of PRESET_SCENARIOS) {
      // toContain is identity-based here: the same object, not a structural copy.
      expect(specs).toContain(preset);
    }
  });

  describe("regime coverage (§3.6: the library is organized by dimensionless groups)", () => {
    const groups = SCENARIO_LIBRARY.map((entry) => ({
      id: entry.id,
      ...scenarioNondimensionalGroups(entry.spec),
    }));

    it("spans at least four decades of the drag-to-gravity group Π", () => {
      const piValues = groups.map((g) => g.pi);
      for (const [i, pi] of piValues.entries()) {
        expect(Number.isFinite(pi), groups[i]!.id).toBe(true);
        expect(pi, groups[i]!.id).toBeGreaterThan(0);
      }
      expect(Math.log10(Math.max(...piValues) / Math.min(...piValues))).toBeGreaterThanOrEqual(4);
    });

    it("spans at least four decades of Reynolds number, from creeping flow to fully turbulent", () => {
      const re = groups.map((g) => g.reynolds);
      expect(Math.min(...re)).toBeLessThan(1e2); // dust grain: Stokes regime
      expect(Math.max(...re)).toBeGreaterThan(1e6); // cannonball at muzzle speed
      expect(Math.log10(Math.max(...re) / Math.min(...re))).toBeGreaterThanOrEqual(4);
    });

    it("reaches the high-subsonic Mach range where compressibility starts to matter", () => {
      // The Cd(M) transonic rise (P4.04) is only visible above roughly M=0.7.
      expect(Math.max(...groups.map((g) => g.mach))).toBeGreaterThan(0.7);
    });

    it("includes spin-free and strongly spinning scenarios", () => {
      const spin = groups.map((g) => g.spinRatio);
      expect(Math.min(...spin)).toBe(0);
      expect(Math.max(...spin)).toBeGreaterThan(0.3);
    });

    it("covers every regime tag the preset browser can filter on", () => {
      const tags = new Set(SCENARIO_LIBRARY.flatMap((entry) => scenarioRegimeTags(entry.spec)));
      expect(tags).toContain("low-pi");
      expect(tags).toContain("high-pi");
      expect(tags).toContain("magnus");
      expect(tags).toContain("stiff");
    });
  });

  describe("spec-feature coverage (every option a ScenarioSpec can express is exercised)", () => {
    it("uses all three registered model kinds", () => {
      const kinds = new Set(SCENARIO_LIBRARY.map((entry) => entry.spec.model.kind ?? "planar"));
      expect(kinds).toEqual(new Set(["planar", "planar-spin", "spatial"]));
    });

    it("uses every force id the runtime resolver can build", () => {
      const forceIds = new Set(SCENARIO_LIBRARY.flatMap((entry) => entry.spec.model.forceIds));
      // Mirrors `resolveForce`'s FORCE_FACTORIES keys; `runtime` cannot be
      // imported from `engine` (dependency direction), so the list is
      // restated and `scenario-library-resolve.test.ts` pins the real one.
      expect(forceIds).toEqual(
        new Set(["gravity", "drag-linear", "drag-quadratic", "magnus", "buoyancy"]),
      );
    });

    it("uses both atmosphere variants and the altitude-dependent gravity option", () => {
      const atmospheres = new Set(
        SCENARIO_LIBRARY.map((entry) => entry.spec.environment.atmosphere.kind),
      );
      expect(atmospheres).toEqual(new Set(["constant", "exponential"]));
      expect(
        SCENARIO_LIBRARY.some((entry) => entry.spec.environment.gravity.altitudeDependent === true),
      ).toBe(true);
    });

    it("covers still air, steady wind, shear, a discrete gust, turbulence and a spatial field", () => {
      const winds = new Set(SCENARIO_LIBRARY.map((entry) => entry.spec.environment.wind.kind));
      for (const kind of [
        "zero",
        "uniform",
        "log-profile",
        "one-cosine-gust",
        "frozen-ou-gust",
        "gaussian-vortex",
      ]) {
        expect(winds, kind).toContain(kind);
      }
    });

    it("includes both adaptive and fixed-step solver configurations", () => {
      const adaptive = SCENARIO_LIBRARY.filter((entry) => entry.spec.solver.rtol !== undefined);
      const fixedStep = SCENARIO_LIBRARY.filter((entry) => entry.spec.solver.h !== undefined);
      expect(adaptive.length).toBeGreaterThan(0);
      expect(fixedStep.length).toBeGreaterThan(0);
      // A spec is one or the other, never both -- a fixed h alongside a
      // tolerance would leave which one governs the step ambiguous.
      for (const entry of SCENARIO_LIBRARY) {
        const hasBoth = entry.spec.solver.h !== undefined && entry.spec.solver.rtol !== undefined;
        expect(hasBoth, entry.id).toBe(false);
      }
    });

    it("keeps the stochastic-wind entry on a nonzero seed so its realisation is pinned", () => {
      const stochastic = SCENARIO_LIBRARY.filter(
        (entry) => entry.spec.environment.wind.kind === "frozen-ou-gust",
      );
      expect(stochastic.length).toBeGreaterThan(0);
      for (const entry of stochastic) {
        expect(entry.spec.seed, entry.id).toBeGreaterThan(0);
      }
    });
  });
});
