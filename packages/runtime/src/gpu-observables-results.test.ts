import { describe, expect, it } from "vitest";

import results from "../../../scripts/gpu-observables-results.json" with { type: "json" };

import { WGSL_OBSERVABLE_DIM, WGSL_OBSERVABLE_OFFSETS } from "./wgsl-observables-kernel.js";

/**
 * Guards for the committed P7.16 measurement.
 *
 * The results file is JSON in the repository, which means the next person to
 * touch it can make it say whatever they like. These tests exist so that the
 * claims it makes have to stay consistent with each other and with the code --
 * a file edited to report a pass it did not measure fails here rather than
 * sitting in the tree looking authoritative.
 *
 * The pattern is `gpu-workgroup-sweep-results.test.ts`'s, which the 100th run
 * added for the same reason on the same class of artefact.
 */

/** Adapter classes whose numbers may be read as evidence about hardware. */
function isSoftwareAdapter(info: { architecture: string | null; vendor: string | null }): boolean {
  const text = `${info.vendor ?? ""} ${info.architecture ?? ""}`.toLowerCase();
  return (
    text.includes("swiftshader") ||
    text.includes("llvmpipe") ||
    text.includes("lavapipe") ||
    text.trim() === ""
  );
}

describe("the recorded run describes the task it claims to answer", () => {
  it("is filed under P7.16 and its own criterion", () => {
    expect(results.task).toBe("P7.16");
    expect(results.criterion).toBe("matches CPU observables within f32 tolerance");
  });

  it("names which of the three readings of 'CPU observables' it measured", () => {
    // The criterion is ambiguous and the 101st run settled it in writing before
    // measuring. A results file that dropped the reading would be reporting a
    // number whose meaning had gone missing.
    expect(results.criterionReading).toContain("Reading (iii)");
    expect(results.criterionReading).toContain("planar-observables-reduction.test.ts");
  });

  it("carries the ensemble that makes the run reproducible", () => {
    expect(results.trajectories).toBe(10_000);
    expect(results.seed).toBe("0x7a14c0de");
    expect(results.h).toBe(0.001);
    expect(results.steps).toBe(12_000);
  });
});

describe("the verdict is a consequence of the recorded numbers, not an independent claim", () => {
  const numeric = results.perObservable.filter((s) => s.observable !== "impacted");

  it("records one entry per observable the kernel writes, in the kernel's order", () => {
    expect(results.perObservable).toHaveLength(WGSL_OBSERVABLE_DIM);
    expect(results.perObservable.map((s) => s.observable)).toEqual(
      Object.keys(WGSL_OBSERVABLE_OFFSETS),
    );
  });

  it("passes its own gate: every numeric observable is inside the recorded budget", () => {
    for (const stat of numeric) {
      expect(stat.maxUlp).toBeLessThanOrEqual(results.ulpBudget);
    }
  });

  it("agrees exactly on the impacted flag, which admits no tolerance", () => {
    expect(results.impactedMismatches).toBe(0);
  });

  it("actually exercised range, which a run where nothing landed would not have", () => {
    // A 2000-step ensemble would have compared `false` against `false` ten
    // thousand times and reported agreement having tested nothing about range.
    expect(results.impactedOnCpu).toBeGreaterThan(0);
    expect(results.impactedOnCpu).toBe(results.trajectories);
  });

  it("keeps identicalTrajectories consistent with the per-observable identity counts", () => {
    // Every trajectory identical on every observable is the only way the
    // whole-trajectory count can equal the ensemble size.
    if (results.identicalTrajectories === results.trajectories) {
      for (const stat of results.perObservable) {
        expect(stat.identicalValues).toBe(results.trajectories);
        expect(stat.maxUlp).toBe(0);
        expect(stat.maxAbs).toBe(0);
      }
    }
    expect(results.identicalTrajectories).toBeLessThanOrEqual(results.trajectories);
  });
});

describe("the budget stays the two-sided one the controls established", () => {
  it("is at least P7.14's integration budget and well below the C2 control", () => {
    // Above 64 because the reduction sits on top of an integration already
    // budgeted at 64; below 1987 because that is where deleting the impact
    // refinement lands, and a budget above it would pass that deletion.
    expect(results.ulpBudget).toBeGreaterThanOrEqual(64);
    expect(results.ulpBudget).toBeLessThan(1987);
  });

  it("states that the budget is not derived from this run's own result", () => {
    expect(results.ulpBudgetBasis).toContain("NOT derived from this run's result");
    expect(results.ulpBudgetBasis).toContain("C2");
  });
});

describe("the provenance cannot be edited to overclaim", () => {
  it("records the adapter the numbers were measured on", () => {
    expect(results.adapterInfo).toBeTypeOf("object");
    expect(results.chromiumVersion).toMatch(/^\d+\./);
  });

  it("says in words that a software adapter settles correctness and not throughput", () => {
    // Re-derived from the recorded adapter rather than trusted from the prose,
    // so a row hand-edited to drop the caveat while keeping a software adapter
    // fails here. This is the 100th run's lesson applied to a second artefact.
    if (isSoftwareAdapter(results.adapterInfo)) {
      expect(results.provenance).toContain("Correctness only");
      expect(results.provenance).toContain("NOTHING about throughput");
    }
  });

  it("reports no uncaptured device errors, which would make the numbers suspect", () => {
    expect(results.deviceErrors).toEqual([]);
  });
});

/**
 * P7.19's criterion, evaluated against this same recorded run.
 *
 * The task's title names a feature -- an in-kernel, fixed-iteration,
 * branch-uniform bisection for the ground crossing -- that P7.16 already
 * delivered as part of this reduction. What P7.19 adds is its criterion, and
 * the criterion is not satisfied by assumption: it is satisfied by the numbers
 * in this file, which is why it is asserted here rather than in a second
 * results artefact nobody would re-run.
 *
 * The recorded file predates the `p719` block that
 * `scripts/measure-gpu-observables.mjs` now writes, so nothing below reads that
 * block. Everything is derived from `perObservable`, which the run did record.
 */
describe("P7.19: the impact abscissa agrees with the CPU within 1e-3 m", () => {
  /** P7.19's budget. Mirrors `IMPACT_X_ABS_BUDGET_M` in the fixture. */
  const IMPACT_X_ABS_BUDGET_M = 1e-3;

  /**
   * One ULP of a binary32 value, spelled locally.
   *
   * Not imported from `planar-precision-study.ts`: that module is P7.17's study
   * harness and this file is a guard over a recorded artefact, so importing it
   * would tie a results guard to a study's API for three lines of arithmetic.
   * `planar-precision-study.test.ts` is where the function itself is tested.
   */
  function ulp32(x: number): number {
    const magnitude = Math.abs(x);
    if (magnitude === 0) return 2 ** -149;
    return 2 ** (Math.floor(Math.log2(magnitude)) - 23);
  }

  const rangeStat = results.perObservable.find((s) => s.observable === "range");

  it("read the criterion on `range`, which is the impact abscissa only because x0 = 0", () => {
    // Neither the kernel nor the CPU reducer emits an absolute impact abscissa;
    // both emit `range = |impactX - x0|`. The equivalence is a property of this
    // ensemble, so the guard asserts the statistic exists rather than silently
    // reading whichever channel happens to be present.
    expect(rangeStat).toBeDefined();
  });

  it("meets the 1e-3 m bar on a batch of 1e4", () => {
    expect(results.trajectories).toBe(10_000);
    expect(rangeStat!.maxAbs).toBeLessThanOrEqual(IMPACT_X_ABS_BUDGET_M);
  });

  it("exercised the bisection rather than comparing two unlanded flights", () => {
    // Every flight that never crosses y = 0 reports range 0 on both sides, so a
    // run in which nothing landed would meet the bar above while measuring
    // nothing at all about the feature P7.19 names.
    expect(results.impactedOnCpu).toBe(results.trajectories);
    expect(results.impactedMismatches).toBe(0);
  });

  /**
   * The finding that makes the second gate necessary, asserted as arithmetic so
   * it cannot be argued away.
   *
   * The instinct is that the 256-ULP gate subsumes a millimetre bar. It does
   * not, and where it stops doing so is exact: 256 ULP is at most 1e-3 m only
   * while the value is below 64 m. This ensemble's ranges are O(100) m.
   */
  it("is NOT implied by the ULP budget at the ranges this ensemble produces", () => {
    // Just inside, on the binade below the crossover.
    expect(results.ulpBudget * ulp32(63.9)).toBeLessThanOrEqual(IMPACT_X_ABS_BUDGET_M);
    // Just outside, on the binade above it -- and by nearly a factor of two.
    expect(results.ulpBudget * ulp32(64)).toBeGreaterThan(IMPACT_X_ABS_BUDGET_M);
    expect(results.ulpBudget * ulp32(100)).toBeCloseTo(1.953e-3, 6);
  });

  it("has teeth: the C2 control that deletes the bisection violates it fifteen times over", () => {
    // C2 replaces the 60-iteration bisection with theta = 0.5 and measures 1987
    // ULP on range. A gate that permitted deleting the feature it gates would
    // be a decoration -- the same test `ulpBudget`'s own derivation had to pass.
    const c2AbsAtHundredMetres = 1987 * ulp32(100);
    expect(c2AbsAtHundredMetres).toBeGreaterThan(15 * IMPACT_X_ABS_BUDGET_M);
  });
});
