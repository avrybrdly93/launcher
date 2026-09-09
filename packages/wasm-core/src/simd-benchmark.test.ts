import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_WORKLOAD,
  SIMD_SPEEDUP_CRITERION,
  benchmarkParams,
  benchmarkState,
  median,
  verdictFor,
} from "./simd-benchmark.js";

/**
 * Pins P7.09's benchmark *definition*. Takes no timing and must never take one.
 *
 * The split is the one `memory-audit.ts` established for P7.06: the script owns
 * the instruments, this module owns what is measured and what counts as
 * passing, and this suite is what makes the second half checkable. A benchmark
 * whose criterion lives only inside the script that reports it can be softened
 * silently -- the script would still print a PASS, and nothing would fail.
 *
 * The second job here is the duplication guard. `measure-simd-speedup.mjs` is
 * plain JavaScript and cannot import a `.ts` module without a build step, so it
 * restates the workload constants. That is a real cost, and the way it is paid
 * is by reading the script's source here and asserting the numbers still agree.
 * Without this, editing the workload in one place would leave the recorded
 * artifact describing a run nobody performed.
 */

const SCRIPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/measure-simd-speedup.mjs",
);
const RESULTS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/simd-speedup-results.json",
);

/** Reads one `key: value` or `key = value` number out of the script's source. */
function scriptNumber(source: string, key: string): number {
  const match = new RegExp(`\\b${key}\\s*[:=]\\s*([0-9.]+)`).exec(source);
  if (match === null) {
    throw new Error(`measure-simd-speedup.mjs no longer declares ${key}`);
  }
  return Number(match[1]);
}

describe("P7.09's criterion", () => {
  it("is the ratio the task's validation line names", () => {
    // The task reads ">=1.8x vs scalar WASM on batch benchmark". If a later
    // session wants a different number it has to change the task, not the code.
    expect(SIMD_SPEEDUP_CRITERION).toBe(1.8);
  });

  it("passes at the criterion exactly, and fails just below it", () => {
    // `>=`, not `>`. Pinned because the boundary is where a criterion is
    // quietly weakened or quietly tightened.
    const atCriterion = verdictFor({
      scalarArtifactMs: 1.8,
      scalarInSimdBuildMs: 1.8,
      simdMs: 1,
    });
    expect(atCriterion.pass).toBe(true);
    expect(atCriterion.speedupVsScalarArtifact).toBeCloseTo(1.8, 12);

    const justBelow = verdictFor({
      scalarArtifactMs: 1.79,
      scalarInSimdBuildMs: 1.79,
      simdMs: 1,
    });
    expect(justBelow.pass).toBe(false);
  });

  it("reads the committed scalar artifact's baseline, not the more favourable one", () => {
    // The control baseline is reported but must not decide the verdict.
    // A run where the in-build scalar looked fast and the real scalar artifact
    // did not must FAIL, because the artifact is what a non-SIMD engine runs.
    const verdict = verdictFor({
      scalarArtifactMs: 1.5,
      scalarInSimdBuildMs: 9,
      simdMs: 1,
    });
    expect(verdict.speedupVsScalarInSimdBuild).toBe(9);
    expect(verdict.pass).toBe(false);
  });
});

describe("the benchmark workload", () => {
  it("uses an odd replicate count, so the scalar tail is on the timed path", () => {
    // An even count would time only the vector loop, leaving the tail measured
    // nowhere while the correctness suite covers it. The two should exercise
    // the same code.
    expect(BENCHMARK_WORKLOAD.replicates % 2).toBe(1);
  });

  it("warms up before timing and takes more than a couple of repetitions", () => {
    // A first call on a cold instance measures the engine tiering up, not the
    // kernel. And a median over two samples is not a median.
    expect(BENCHMARK_WORKLOAD.warmupRounds).toBeGreaterThanOrEqual(5);
    expect(BENCHMARK_WORKLOAD.repetitions).toBeGreaterThanOrEqual(5);
  });

  it("is heterogeneous, so it cannot be one problem timed N times", () => {
    // Beyond realism: a homogeneous ensemble lets a branch predictor and a
    // cache behave in ways they would not on real work, and the ratio would
    // then be a property of the fixture.
    expect(benchmarkParams(0)).not.toEqual(benchmarkParams(1));
    expect(benchmarkState(0)).not.toEqual(benchmarkState(1));
    expect(benchmarkParams(0)).toHaveLength(7);
    expect(benchmarkState(0)).toHaveLength(4);
  });

  it("spans rising and falling trajectories", () => {
    // `vy` crosses zero across the ensemble, so the running-max branch is taken
    // for some replicates and not others rather than being uniformly
    // predictable.
    const first = benchmarkState(0)[3]!;
    const last = benchmarkState(BENCHMARK_WORKLOAD.replicates - 1)[3]!;
    expect(Math.sign(first)).not.toBe(Math.sign(last));
  });
});

describe("the measuring script", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  it("mirrors this module's workload rather than drifting from it", () => {
    for (const key of ["replicates", "steps", "warmupRounds", "repetitions"] as const) {
      expect(scriptNumber(source, key), `measure-simd-speedup.mjs ${key}`).toBe(
        BENCHMARK_WORKLOAD[key],
      );
    }
    expect(scriptNumber(source, "h")).toBe(BENCHMARK_WORKLOAD.h);
    expect(scriptNumber(source, "CRITERION")).toBe(SIMD_SPEEDUP_CRITERION);
  });

  it("checks bit-identity before it reports any timing", () => {
    // The ordering is the substance: a ratio printed beside a silently wrong
    // result is worse than no ratio. Asserted on the source because asserting
    // it by running the script would make this suite a benchmark.
    const identityAt = source.indexOf("Object.is(reference[i], produced[i])");
    const timingAt = source.indexOf("function timeOnce");
    const reportAt = source.indexOf('console.log("P7.09 SIMD speedup")');
    expect(identityAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(identityAt);
    expect(timingAt).toBeGreaterThan(-1);
  });

  it("soft-warns by default and only gates under --strict", () => {
    // This repository's convention for perf checks: the artifact is the
    // deliverable, the exit code is not the evidence.
    expect(source).toContain("::warning::");
    expect(source).toContain("--strict");
  });
});

describe("the recorded artifact", () => {
  const report = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as {
    task: string;
    workload: Record<string, number>;
    verdict: { criterion: number; pass: boolean; speedupVsScalarArtifact: number };
    reading: { medianMs: Record<string, number> };
  };

  it("was produced by the workload this module defines", () => {
    // A committed result describing a run nobody can reproduce from the code in
    // the tree is not evidence. This is what notices.
    expect(report.task).toBe("P7.09");
    expect(report.workload.replicates).toBe(BENCHMARK_WORKLOAD.replicates);
    expect(report.workload.steps).toBe(BENCHMARK_WORKLOAD.steps);
    expect(report.verdict.criterion).toBe(SIMD_SPEEDUP_CRITERION);
  });

  it("records a verdict consistent with its own timings", () => {
    // Recomputed from the recorded medians rather than trusted: a hand-edited
    // `pass: true` over a failing ratio is exactly the fabrication this checks.
    const recomputed = verdictFor({
      scalarArtifactMs: report.reading.medianMs.scalarArtifact!,
      scalarInSimdBuildMs: report.reading.medianMs.scalarInSimdBuild!,
      simdMs: report.reading.medianMs.simd!,
    });
    expect(recomputed.pass).toBe(report.verdict.pass);
    expect(recomputed.speedupVsScalarArtifact).toBeCloseTo(
      report.verdict.speedupVsScalarArtifact,
      9,
    );
  });
});

describe("median", () => {
  it("is the middle of an odd sample and the lower middle of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("refuses an empty sample rather than returning undefined", () => {
    expect(() => median([])).toThrow(RangeError);
  });
});
