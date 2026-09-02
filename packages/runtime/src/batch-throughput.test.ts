import { describe, expect, it } from "vitest";

import {
  ACCURACY_CEILING,
  THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND,
  THROUGHPUT_STEP_LADDER,
  THROUGHPUT_WORKERS,
  benchmarkReferenceStudy,
  benchmarkStudy,
  meetsBudget,
  partitionReplicates,
  throughputFrom,
  verdictRung,
  type LadderRung,
} from "./batch-throughput.js";
import { createMcColumns, runMcRange, runMcReplicate } from "./mc-job.js";

// P6.26. What this file can and cannot assert, stated up front because the
// division is the whole design:
//
//   IT CAN assert the benchmark's *definition* -- that the workload is the
//   one §2.6 names (fixed-step RK4, observables only), that the step ladder
//   is accurate enough for a throughput number taken on it to mean anything,
//   that the partition is exhaustive and cannot change a result, and that the
//   verdict rule reads the rung it says it reads.
//
//   IT CANNOT assert the throughput. A number measured under vitest, sharing
//   a machine with whatever else the suite is doing, is not the number the
//   budget is about; `scripts/measure-batch-throughput.mjs` measures it on
//   real threads and CI keeps the artifact. So there is no timing assertion
//   here at all, rather than a loose one that would fail on a busy runner and
//   teach everyone to ignore it.
//
// The accuracy leg is the one that matters most, because it is what stops the
// step size being tuned until the throughput clears the budget: if a coarser
// step were quietly substituted, the measured error would rise and
// `verdictRung` would stop selecting it.

describe("benchmarkStudy: the workload is the one §2.6's budget names", () => {
  it("integrates with fixed-step classical RK4 and carries no adaptive field", () => {
    for (const step of THROUGHPUT_STEP_LADDER) {
      const solver = benchmarkStudy(step, 8).base.solver;
      expect(solver.stepper).toBe("classical-rk4");
      expect(solver.h).toBe(step);
      // An adaptive field surviving here would change the workload without
      // changing the stepper id, which is exactly the kind of drift a
      // throughput number cannot show.
      expect(solver.rtol).toBeUndefined();
      expect(solver.atol).toBeUndefined();
      expect(solver.controller).toBeUndefined();
    }
  });

  it("varies its replicates, so the measured work is an ensemble and not one trajectory repeated", () => {
    // A study with no overlays draws the same vector every replicate. That is
    // a different workload -- and one a runtime may legitimately optimize.
    const study = benchmarkStudy(0.05, 4);
    expect(study.overlays.length).toBeGreaterThan(0);

    const columns = createMcColumns(4);
    runMcRange({ study }, 0, 4, columns);
    const distinct = new Set(Array.from(columns.range));
    expect(distinct.size).toBe(4);
  });

  it("lands every replicate, so no replicate is timed out rather than integrated", () => {
    // A replicate that outruns MC_T_MAX_SECONDS costs a full horizon of steps
    // and reports `landed = 0`. One in the ensemble would inflate the work
    // per trajectory while contributing nothing, so the benchmark's scenario
    // is required to be one where that never happens.
    const columns = createMcColumns(32);
    runMcRange({ study: benchmarkStudy(0.05, 32) }, 0, 32, columns);
    expect(Array.from(columns.landed)).toEqual(Array.from({ length: 32 }, () => 1));
  });
});

describe("the step ladder is accurate enough for its throughput to mean anything", () => {
  // The measured errors on this machine (Node 22, x64) are recorded beside
  // each step, because the point of the ladder is that a reader can see what
  // every rung would have given rather than only the one the verdict lands on.
  //
  //   h = 0.1    ~2.2e-8   -- outside ACCURACY_CEILING, ineligible
  //   h = 0.05   ~1.3e-9
  //   h = 0.02   ~3.4e-11
  //   h = 0.01   ~2.2e-12
  //
  // RK4 is fourth order, so each halving should cut the error by ~16, and the
  // ladder above does. That is asserted below rather than left as a comment:
  // an error that stopped falling at fourth order would mean the "fixed-step
  // RK4" label had stopped describing what runs.
  const reference = runMcReplicate({ study: benchmarkReferenceStudy(1) }, 0);

  function relativeRangeError(step: number): number {
    const result = runMcReplicate({ study: benchmarkStudy(step, 1) }, 0);
    return Math.abs(result.range - reference.range) / Math.abs(reference.range);
  }

  it("at least one rung is inside the accuracy ceiling, or there is no verdict to read", () => {
    const errors = THROUGHPUT_STEP_LADDER.map(relativeRangeError);
    expect(errors.some((error) => error <= ACCURACY_CEILING)).toBe(true);
  });

  it("every rung is inside §2.6's own 1e-6 accuracy budget", () => {
    for (const step of THROUGHPUT_STEP_LADDER) {
      expect(relativeRangeError(step)).toBeLessThan(1e-6);
    }
  });

  it("the error falls at fourth order down the ladder", () => {
    const steps = [...THROUGHPUT_STEP_LADDER].sort((a, b) => b - a);
    for (let i = 0; i + 1 < steps.length; i++) {
      const coarse = steps[i]!;
      const fine = steps[i + 1]!;
      const ratio = relativeRangeError(coarse) / relativeRangeError(fine);
      const expected = (coarse / fine) ** 4;
      // Half an order of magnitude either side: the measured order is a
      // fourth-order scheme's, not a fitted constant, and the event-localized
      // impact adds its own small contribution.
      expect(ratio).toBeGreaterThan(expected / 3);
      expect(ratio).toBeLessThan(expected * 3);
    }
  });
});

describe("partitionReplicates", () => {
  it("covers every replicate exactly once, contiguously, for an even split", () => {
    const chunks = partitionReplicates(4000, THROUGHPUT_WORKERS);
    expect(chunks).toEqual([
      { startIndex: 0, endIndex: 1000 },
      { startIndex: 1000, endIndex: 2000 },
      { startIndex: 2000, endIndex: 3000 },
      { startIndex: 3000, endIndex: 4000 },
    ]);
  });

  it("spreads the remainder one replicate at a time rather than onto one worker", () => {
    const chunks = partitionReplicates(4003, 4);
    expect(chunks.map((c) => c.endIndex - c.startIndex)).toEqual([1001, 1001, 1001, 1000]);
    expect(chunks[0]!.startIndex).toBe(0);
    expect(chunks.at(-1)!.endIndex).toBe(4003);
    for (let i = 0; i + 1 < chunks.length; i++) {
      expect(chunks[i]!.endIndex).toBe(chunks[i + 1]!.startIndex);
    }
  });

  it("gives a worker with nothing to do an empty chunk rather than throwing", () => {
    expect(partitionReplicates(2, 4)).toEqual([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 1, endIndex: 2 },
      { startIndex: 2, endIndex: 2 },
      { startIndex: 2, endIndex: 2 },
    ]);
  });

  it("rejects a non-integer or negative replicate count and a worker count below one", () => {
    expect(() => partitionReplicates(1.5, 4)).toThrow(/non-negative integer/);
    expect(() => partitionReplicates(-1, 4)).toThrow(/non-negative integer/);
    expect(() => partitionReplicates(10, 0)).toThrow(/positive integer/);
  });

  it("cannot change a single number: three partitions of one study agree bit for bit", () => {
    // §5.6's determinism-under-parallelism principle, made executable. A
    // replicate is a pure function of the study seed and its own index
    // (P6.03), so how the range is cut up is a scheduling decision and
    // nothing else -- and a benchmark whose partition moved its results would
    // be measuring a different ensemble per worker count.
    const study = benchmarkStudy(0.05, 12);

    function runUnder(workers: number): number[] {
      const whole = new Float64Array(12);
      for (const chunk of partitionReplicates(12, workers)) {
        const size = chunk.endIndex - chunk.startIndex;
        if (size === 0) continue;
        const columns = createMcColumns(size);
        runMcRange({ study }, chunk.startIndex, chunk.endIndex, columns);
        whole.set(columns.range, chunk.startIndex);
      }
      return Array.from(whole);
    }

    const single = runUnder(1);
    expect(runUnder(4)).toEqual(single);
    expect(runUnder(5)).toEqual(single);
    expect(single.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });
});

describe("throughputFrom", () => {
  it("divides replicates by wall-clock seconds", () => {
    const measurement = throughputFrom(0.05, 40_000, 4, 4.0);
    expect(measurement.trajectoriesPerSecond).toBe(10_000);
    expect(measurement).toMatchObject({ stepSize: 0.05, replicates: 40_000, workers: 4 });
  });

  it("refuses a non-positive or non-finite elapsed time rather than reporting Infinity", () => {
    expect(() => throughputFrom(0.05, 100, 4, 0)).toThrow(/positive and finite/);
    expect(() => throughputFrom(0.05, 100, 4, Number.NaN)).toThrow(/positive and finite/);
  });
});

describe("verdictRung: the rule that picks which rung the budget is read at", () => {
  function rung(stepSize: number, relativeRangeError: number, rate: number): LadderRung {
    return {
      stepSize,
      relativeRangeError,
      replicates: 1000,
      workers: 4,
      elapsedSeconds: 1000 / rate,
      trajectoriesPerSecond: rate,
    };
  }

  it("takes the coarsest rung inside the accuracy ceiling, not the fastest overall", () => {
    const rungs = [
      rung(0.1, 2.2e-8, 20_000), // fastest, but outside the ceiling
      rung(0.05, 1.3e-9, 9_000),
      rung(0.02, 3.4e-11, 3_500),
    ];
    expect(verdictRung(rungs)?.stepSize).toBe(0.05);
  });

  it("returns undefined when no rung is accurate enough, rather than falling back to the fastest", () => {
    // "The ladder never reached the required accuracy" and "the budget was
    // missed" are different findings, and a fallback here would report the
    // second when the first is true.
    expect(verdictRung([rung(0.1, 1e-3, 50_000), rung(0.05, 1e-4, 25_000)])).toBeUndefined();
  });

  it("admits a rung exactly at the ceiling", () => {
    expect(verdictRung([rung(0.1, ACCURACY_CEILING, 12_000)])?.stepSize).toBe(0.1);
  });
});

describe("meetsBudget", () => {
  it("is §2.6's threshold, inclusive at the boundary", () => {
    const at = {
      stepSize: 0.05,
      relativeRangeError: 0,
      replicates: 1,
      workers: 4,
      elapsedSeconds: 1,
      trajectoriesPerSecond: THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND,
    } satisfies LadderRung;
    expect(meetsBudget(at)).toBe(true);
    expect(meetsBudget({ ...at, trajectoriesPerSecond: 9_999.9 })).toBe(false);
  });
});
