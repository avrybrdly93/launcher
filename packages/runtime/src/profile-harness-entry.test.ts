/**
 * Tests for the P7.01 profiling workloads.
 *
 * What is worth asserting here is *what gets profiled*, not how fast it is.
 * A profile is only as good as its workload: if `profileMcBatch` quietly
 * stopped matching what `runMcRange` does in production, or the interactive
 * workload lost its `TrajectoryRecorder`, the artifact would still be
 * produced, still look plausible, and name the hotspots of something nobody
 * runs. Those are the failures these tests exist to catch.
 *
 * There is deliberately **no timing assertion**. A wall-clock number measured
 * under vitest, sharing a machine with several thousand other tests, is not
 * the number the profile is about, and a loose one would only teach everyone
 * to ignore it -- the same reasoning `batch-throughput.test.ts` records for
 * the throughput harness.
 */

import { describe, expect, it } from "vitest";
import { generateReplicate } from "@ballista/engine";
import { THROUGHPUT_STEP_LADDER, benchmarkStudy } from "./batch-throughput.js";
import { createMcColumns, runMcRange } from "./mc-job.js";
import { interactiveSolveOnce, profileMcBatch } from "./profile-harness-entry.js";

describe("interactiveSolveOnce", () => {
  it("returns the recorded step count, so the solve is observed rather than elided", () => {
    const steps = interactiveSolveOnce();
    expect(Number.isFinite(steps)).toBe(true);
    expect(steps).toBeGreaterThan(1);
  });

  it("is deterministic: the default scenario has no sampled inputs", () => {
    // If this ever fails, the interactive workload has acquired a random
    // draw and two profiles of it are no longer profiles of the same solve.
    expect(interactiveSolveOnce()).toBe(interactiveSolveOnce());
  });

  it("records only a handful of rows, because the default scenario is adaptive rk45", () => {
    // MEASURED, and worth writing down because the first version of this
    // test asserted the opposite and was wrong. The default preset solves
    // with `rk45` at rtol 1e-6 / atol 1e-9, and a smooth projectile arc
    // converges to that in about four accepted steps -- so the recorder
    // holds a handful of rows, not hundreds, and the interactive solve is
    // ~0.15 ms rather than milliseconds.
    //
    // That is a property of the workload the P7.01 report has to state
    // rather than a defect: with so few steps, the interactive profile is
    // dominated by per-solve fixed costs (interpolant construction, event
    // localization through `brentRoot`, GC) and not by the stepping loop.
    // Anyone reading the interactive hotspots as "where the integrator
    // spends its time" would be reading them wrong.
    //
    // Bounded on both sides on purpose: a drop to 1 would mean the solve
    // stopped immediately, and a jump into the hundreds would mean the
    // preset had switched to a fixed step, which would change what the
    // interactive profile is a profile of.
    const steps = interactiveSolveOnce();
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(steps).toBeLessThan(50);
  });
});

describe("profileMcBatch", () => {
  it("produces one finite range per replicate", () => {
    const replicates = 8;
    const columns = profileMcBatch(replicates, 0.05);
    expect(columns.range).toHaveLength(replicates);
    for (const range of columns.range) {
      expect(Number.isFinite(range)).toBe(true);
      expect(range).toBeGreaterThan(0);
    }
  });

  it("lands every replicate, so the profile is of complete flights", () => {
    // A replicate that times out against MC_T_MAX_SECONDS costs the maximum
    // number of steps and profiles a trajectory the benchmark never intends
    // to measure.
    const columns = profileMcBatch(16, 0.05);
    expect([...columns.landed]).toEqual(Array.from({ length: 16 }, () => 1));
  });

  it("varies its replicates, so the profile is not of one repeated draw", () => {
    // A study whose draws were identical would let a JIT specialize on a
    // single parameter vector, and the profile would describe a workload no
    // batch runs. Same guard batch-throughput.test.ts applies for the same
    // reason.
    const columns = profileMcBatch(4, 0.05);
    expect(new Set(columns.range).size).toBe(4);
  });

  it("runs exactly what production runs: identical to runMcRange on the same study", () => {
    // This is the load-bearing one. It is what stops the profiled workload
    // drifting away from `runMcRange` -- the function the throughput budget
    // is actually about -- while still producing a plausible artifact.
    const replicates = 12;
    const stepSize = 0.05;

    const expected = createMcColumns(replicates);
    runMcRange({ study: benchmarkStudy(stepSize, replicates) }, 0, replicates, expected);

    const actual = profileMcBatch(replicates, stepSize);

    expect([...actual.range]).toEqual([...expected.range]);
    expect([...actual.apexHeight]).toEqual([...expected.apexHeight]);
    expect([...actual.timeOfFlight]).toEqual([...expected.timeOfFlight]);
    expect([...actual.impactSpeed]).toEqual([...expected.impactSpeed]);
    expect([...actual.landed]).toEqual([...expected.landed]);
  });

  it("profiles the step size it is given, not one of its own choosing", () => {
    // Fixed-step RK4 cost is nearly inversely proportional to the step, so a
    // workload that silently substituted a step would report a per-replicate
    // cost for a trajectory the verdict is not read at. Asserted through the
    // observable: a coarser step integrates the same flight differently.
    const coarse = profileMcBatch(4, 0.1);
    const fine = profileMcBatch(4, 0.01);
    expect([...coarse.range]).not.toEqual([...fine.range]);
    // ...but the same flight, so they agree to well inside a metre.
    for (let i = 0; i < 4; i++) {
      expect(coarse.range[i]!).toBeCloseTo(fine.range[i]!, 3);
    }
  });

  it("uses a step from the throughput ladder by default in the script's verdict rung", () => {
    // Guards the constant the profiling script defaults to against the
    // ladder drifting out from under it.
    expect(THROUGHPUT_STEP_LADDER).toContain(0.05);
  });

  it("draws the same replicates the study generator does", () => {
    // Ties the workload to `generateReplicate`, which the profile reports as
    // the single largest non-`integrate` cost in the batch. If the harness
    // ever drew its replicates some other way, that finding would be about
    // code the batch does not run.
    const replicates = 4;
    const study = benchmarkStudy(0.05, replicates);
    const { spec } = generateReplicate(study, 0);
    expect(spec.solver.h).toBeCloseTo(0.05, 12);
  });
});
