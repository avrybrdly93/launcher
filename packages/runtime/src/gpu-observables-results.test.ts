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
