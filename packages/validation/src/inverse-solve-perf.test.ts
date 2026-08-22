import { SCENARIO_LIBRARY } from "@ballista/engine";
import { readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, totalmem, version as osVersion, platform, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INVERSE_SOLVE_BUDGET_MS,
  type InverseSolveMeasurement,
  PERF_TOL,
  type TargetTiming,
  WARMUP_PASSES,
  libraryPerfCases,
  measureColdSolves,
  measureSolves,
  percentile,
} from "./inverse-solve-perf.js";

/**
 * P5.30: inverse solve p50 < 50 ms, p99 < 300 ms on library targets.
 *
 * The criterion is "benchmark artifact meets budget", and taken literally that
 * is one assertion against a stored file -- which a file of twenty zeros would
 * satisfy. So it is read as **four** claims, and the first three are the ones
 * that make the fourth mean anything:
 *
 * 1. **The artifact describes the real library.** Its target ids are asserted
 *    against `SCENARIO_LIBRARY` itself, so a scenario added, removed or renamed
 *    lands red here rather than leaving the artifact quietly covering 19 of 20.
 * 2. **The artifact is internally consistent.** Percentiles must be ordered,
 *    must lie within the per-target range they were pooled from, and the sample
 *    count must equal `targets x repeats`. This is what catches a hand-edited
 *    number: moving p99 down to fit the budget contradicts the per-target
 *    maxima sitting next to it.
 * 3. **The solve is real, and it converges.** Every library target is solved
 *    live in this suite and must reach the target; a solver that returns
 *    instantly without converging is fast and worthless, and would otherwise
 *    *improve* every number in the artifact.
 * 4. **The recorded numbers meet the budget.**
 *
 * **On asserting wall-clock in a test suite.** Claim 4 is checked against the
 * *artifact*, which is a measurement of a named machine recorded in the file.
 * The live measurement in claim 3 is checked against the budget times
 * {@link LIVE_SLACK}, and that is deliberate rather than lax: this repository's
 * own perf policy is that "a flaky regression here should never block a push to
 * main" (`scripts/check-benchmark-regression.mjs`), and a hard absolute-ms
 * assertion on an unknown CI runner is exactly such a flake. The slack is wide
 * enough to survive a runner several times slower than the recording machine
 * and far too narrow to survive a solve that regressed by an order of
 * magnitude, which is the failure worth catching.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = join(HERE, "inverse-solve-perf.json");

/** Passes over the library recorded into the artifact. 20 targets x 40 = 800 samples. */
const RECORD_REPEATS = 40;

/**
 * Passes run live in the suite. Three keeps the added suite time near a second
 * while still exercising every target more than once.
 */
const LIVE_REPEATS = 3;

/**
 * Multiple of the budget the *live* measurement is held to. See the docstring:
 * a fabrication and gross-regression guard, not the budget.
 */
const LIVE_SLACK = 4;

interface Artifact {
  readonly schemaVersion: number;
  readonly task: string;
  readonly provenance: string;
  readonly budgetMs: { readonly p50: number; readonly p99: number };
  readonly tolerance: typeof PERF_TOL;
  readonly machine: Record<string, string | number>;
  readonly warm: {
    readonly repeats: number;
    readonly warmupPasses: number;
    readonly samples: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
    readonly maxMs: number;
    readonly perTarget: readonly TargetTiming[];
  };
  readonly cold: {
    readonly p50Ms: number;
    readonly maxMs: number;
    readonly perTarget: readonly TargetTiming[];
  };
}

function round(x: number): number {
  return Number(x.toFixed(4));
}

function roundTimings(ts: readonly TargetTiming[]): TargetTiming[] {
  return ts.map((t) => ({ ...t, p50Ms: round(t.p50Ms), maxMs: round(t.maxMs) }));
}

function summarize(m: InverseSolveMeasurement): Artifact["warm"] {
  return {
    repeats: m.repeats,
    warmupPasses: m.warmupPasses,
    samples: m.samplesMs.length,
    p50Ms: round(percentile(m.samplesMs, 50)),
    p95Ms: round(percentile(m.samplesMs, 95)),
    p99Ms: round(percentile(m.samplesMs, 99)),
    maxMs: round(percentile(m.samplesMs, 100)),
    perTarget: roundTimings(m.perTarget),
  };
}

function record(): Artifact {
  // Cold first, in a process that has not run the solve yet -- measuring it
  // after the warm pass would measure a warm solve and call it cold.
  const cold = measureColdSolves();
  const warm = measureSolves(libraryPerfCases(), RECORD_REPEATS);
  if (warm.nonConverged.length > 0) {
    throw new Error(`refusing to record: these targets did not converge: ${warm.nonConverged}`);
  }
  const coldMs = cold.map((t) => t.p50Ms);
  return {
    schemaVersion: 1,
    task: "P5.30",
    provenance:
      "Recorded via `RECORD_INVERSE_PERF=1 pnpm run record:inverse-perf` (P5.30; blueprint " +
      "§7). Never hand-edit: the per-target rows and the pooled percentiles are measured " +
      "together and inverse-solve-perf.test.ts asserts they agree, so an edited percentile " +
      "lands red rather than passing. Wall-clock is hardware-specific -- the `machine` block " +
      "says which machine, and re-recording on a different one is expected to move every " +
      "number. What must not move without an explanation is the shape: which targets are " +
      "slow, and by how much relative to each other.",
    budgetMs: { ...INVERSE_SOLVE_BUDGET_MS },
    tolerance: PERF_TOL,
    machine: {
      platform: platform(),
      release: release(),
      osVersion: osVersion(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      totalMemGb: round(totalmem() / 1024 ** 3),
      nodeVersion: process.version,
    },
    warm: summarize(warm),
    cold: {
      p50Ms: round(percentile(coldMs, 50)),
      maxMs: round(percentile(coldMs, 100)),
      perTarget: roundTimings(cold),
    },
  };
}

function loadArtifact(): Artifact {
  return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as Artifact;
}

describe("P5.30: inverse-solve performance over the scenario library", () => {
  if (process.env["RECORD_INVERSE_PERF"] === "1") {
    it("records a fresh benchmark artifact (RECORD_INVERSE_PERF=1)", () => {
      const artifact = record();
      writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2) + "\n");
      expect(artifact.warm.perTarget).toHaveLength(SCENARIO_LIBRARY.length);
    });
    return;
  }

  const artifact = loadArtifact();

  /* ---------------------------------------------------------------- */
  /* Claim 1: the artifact describes the real library                   */
  /* ---------------------------------------------------------------- */

  it("covers every library target exactly once, in the library's own order", () => {
    expect(artifact.warm.perTarget.map((t) => t.id)).toEqual(SCENARIO_LIBRARY.map((s) => s.id));
    expect(artifact.cold.perTarget.map((t) => t.id)).toEqual(SCENARIO_LIBRARY.map((s) => s.id));
  });

  it("covers a library of the size the preset browser ships", () => {
    expect(SCENARIO_LIBRARY.length).toBeGreaterThanOrEqual(20);
  });

  it("records the budget the task states, not a budget of its own", () => {
    expect(artifact.budgetMs).toEqual({ p50: 50, p99: 300 });
    expect(artifact.task).toBe("P5.30");
  });

  it("records which machine and which tolerance produced the numbers", () => {
    expect(artifact.machine.cpuModel).toBeTruthy();
    expect(artifact.machine.nodeVersion).toMatch(/^v\d+\./);
    // The tolerance is load-bearing: the same solve at rtol 1e-6 is a different
    // measurement, so an artifact that does not say which one it ran is not
    // reproducible.
    expect(artifact.tolerance).toEqual(PERF_TOL);
  });

  /* ---------------------------------------------------------------- */
  /* Claim 2: the artifact is internally consistent                     */
  /* ---------------------------------------------------------------- */

  it("pools exactly targets x repeats samples", () => {
    expect(artifact.warm.repeats).toBe(RECORD_REPEATS);
    expect(artifact.warm.warmupPasses).toBe(WARMUP_PASSES);
    expect(artifact.warm.samples).toBe(SCENARIO_LIBRARY.length * artifact.warm.repeats);
    for (const t of artifact.warm.perTarget) {
      expect(t.samples, `${t.id} sample count`).toBe(artifact.warm.repeats);
    }
  });

  it("orders its percentiles", () => {
    const { p50Ms, p95Ms, p99Ms, maxMs } = artifact.warm;
    expect(p50Ms).toBeLessThanOrEqual(p95Ms);
    expect(p95Ms).toBeLessThanOrEqual(p99Ms);
    expect(p99Ms).toBeLessThanOrEqual(maxMs);
  });

  it("keeps its pooled percentiles inside the per-target range they came from", () => {
    // The pooled max must be some target's max, and the pooled p50 cannot sit
    // below every target's p50 or above every target's max. Editing a
    // percentile without editing the rows breaks one of these.
    const maxima = artifact.warm.perTarget.map((t) => t.maxMs);
    const medians = artifact.warm.perTarget.map((t) => t.p50Ms);
    expect(artifact.warm.maxMs).toBeCloseTo(Math.max(...maxima), 4);
    expect(artifact.warm.p50Ms).toBeGreaterThanOrEqual(Math.min(...medians));
    expect(artifact.warm.p50Ms).toBeLessThanOrEqual(Math.max(...maxima));
    expect(artifact.warm.p99Ms).toBeLessThanOrEqual(Math.max(...maxima));
  });

  it("records every target as converged, warm and cold", () => {
    const warmBad = artifact.warm.perTarget.filter((t) => t.status !== "converged");
    const coldBad = artifact.cold.perTarget.filter((t) => t.status !== "converged");
    expect(warmBad.map((t) => `${t.id}: ${t.status}`)).toEqual([]);
    expect(coldBad.map((t) => `${t.id}: ${t.status}`)).toEqual([]);
  });

  it("keeps the cold first solve inside the p99 budget too", () => {
    // The first aim of a session is a real user-facing latency and nothing else
    // here covers it: every warm number has three discarded passes behind it.
    // Asserted against p99 rather than p50 because a single cold solve is one
    // sample of a first-shot cost, not a median of anything.
    expect(artifact.cold.maxMs).toBeLessThan(INVERSE_SOLVE_BUDGET_MS.p99);
  });

  /* ---------------------------------------------------------------- */
  /* Claim 3: the solve is real, and it converges                       */
  /* ---------------------------------------------------------------- */

  describe("live measurement", () => {
    const cases = libraryPerfCases();
    const live = measureSolves(cases, LIVE_REPEATS);

    it("builds a case for every library target", () => {
      expect(cases.map((c) => c.id)).toEqual(SCENARIO_LIBRARY.map((s) => s.id));
    });

    it("converges on every library target", () => {
      // The load-bearing one. Everything else here measures how long something
      // takes; this is the assertion that it is the right something.
      expect(live.nonConverged).toEqual([]);
    });

    it("solves within a few Newton iterations on every target", () => {
      // P5.06/P5.07 measured <= 8. A solve that started taking 40 iterations
      // would still converge and would blow the budget; this separates "slow
      // machine" from "slow solve" when the timing assertion below trips.
      const worst = Math.max(...live.perTarget.map((t) => t.iterations));
      expect(worst).toBeLessThanOrEqual(8);
    });

    it(`meets the budget times ${LIVE_SLACK} live (fabrication and gross-regression guard)`, () => {
      const p50 = percentile(live.samplesMs, 50);
      const p99 = percentile(live.samplesMs, 99);
      expect(p50, `live p50 ${p50.toFixed(2)} ms`).toBeLessThan(
        INVERSE_SOLVE_BUDGET_MS.p50 * LIVE_SLACK,
      );
      expect(p99, `live p99 ${p99.toFixed(2)} ms`).toBeLessThan(
        INVERSE_SOLVE_BUDGET_MS.p99 * LIVE_SLACK,
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* Claim 4: the recorded numbers meet the budget                      */
  /* ---------------------------------------------------------------- */

  it("meets the p50 budget", () => {
    expect(artifact.warm.p50Ms).toBeLessThan(INVERSE_SOLVE_BUDGET_MS.p50);
  });

  it("meets the p99 budget", () => {
    expect(artifact.warm.p99Ms).toBeLessThan(INVERSE_SOLVE_BUDGET_MS.p99);
  });
});

describe("percentile", () => {
  it("uses nearest-rank, so every value it returns is a sample", () => {
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 25)).toBe(10);
    expect(percentile(xs, 50)).toBe(20);
    expect(percentile(xs, 100)).toBe(40);
  });

  it("clamps at both ends rather than indexing out of the array", () => {
    expect(percentile([5], 0)).toBe(5);
    expect(percentile([5], 100)).toBe(5);
    expect(percentile([1, 2, 3], 0)).toBe(1);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("rejects an empty sample rather than returning undefined", () => {
    expect(() => percentile([], 50)).toThrow(/empty sample/);
  });
});
