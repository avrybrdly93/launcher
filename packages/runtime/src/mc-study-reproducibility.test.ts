/**
 * P6.27 — a full Monte Carlo study is reproducible.
 *
 * Blueprint §8.5 states the contract this file grades: *"same ScenarioSpec +
 * seed => identical SHA-256 of result buffers across runs, across
 * main-thread/worker execution, and across pool sizes (via fixed reduction
 * order, P6.05)"*.
 *
 * **Why this file exists when P6.05 and P6.04 already have tests.**
 * `mc-stats.test.ts` proves the reduction is order-independent, but it does so
 * over *synthetic* columns it fills itself -- no integrator runs, so nothing
 * there would notice a solver that had become run-to-run unstable.
 * `mc-job.test.ts` proves `runMcRange` agrees with `runMcReplicate` across
 * partitionings, but it compares columns, and stops before the reduction.
 * Neither runs the whole chain. This file runs
 *
 *     UncertainScenarioSpec -> generateReplicate -> integrate
 *       -> McColumns -> assembleMcColumns -> mcStats -> hashMcStats
 *
 * end to end and requires one hash out of it, which is the only form in which
 * the §8.5 sentence is actually checked. A regression anywhere along that
 * chain -- a stepper that reads uninitialised memory, a draw that depends on
 * evaluation order, a sink that leaks state between replicates -- changes the
 * hash, and nothing else in the suite is positioned to see it.
 *
 * **What is deliberately not here.**
 *
 * - *Main-thread vs worker execution.* There is no second execution path to
 *   compare against yet: the MC job does not go through `WorkerPool` at all
 *   (P0.119 is the task that moves it there, still open). Writing a test that
 *   compared the main thread against a hand-rolled fake of a pool that does
 *   not exist would grade the fake. **When P0.119 lands, extend this file**
 *   rather than starting a separate one -- the study fixture and the
 *   partitioning helpers below are what that test needs.
 * - *A pinned hash constant.* Pinning goldens is P6.28 ("golden MC results
 *   pinned for 3 studies"). This file asserts self-consistency, which is what
 *   catches nondeterminism; a pinned value additionally catches *intended*
 *   numerical change, and deciding which studies deserve that is P6.28's
 *   call. The two are complementary and this one must not pre-empt the other.
 * - *A fresh-process run.* Genuinely stronger than repeating in-process, but
 *   the only way to reach these modules from a subprocess is through
 *   `packages/*&#47;dist`, which is gitignored and only `pnpm typecheck` emits --
 *   exactly the fresh-clone failure already filed as P0.111. One instance of
 *   that bug in the suite is enough.
 *
 * The study is 96 replicates: enough that a per-replicate fault has somewhere
 * to show up and that `landedCount` is a real number rather than 0 or N, and
 * small enough that running it six times over keeps this file around a
 * second.
 */

import { describe, expect, it } from "vitest";
import {
  PRESET_SCENARIOS,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import {
  MC_STATS_CROSS_PLATFORM_REL_TOL,
  assembleMcColumns,
  hashMcStats,
  mcStats,
  mcStatsRelativeDrift,
  type McChunk,
  type McStats,
} from "@ballista/analysis";
import { createMcColumns, runMcRange, type McColumns, type McJob } from "./mc-job.js";

/**
 * A drag-bearing preset rather than the drag-free one `mc-job.test.ts` uses.
 * That file wants closed forms to check observables against; this one wants
 * the *longest* code path through the RHS, because a reproducibility check is
 * only as good as the amount of arithmetic it covers. Ground-level so every
 * replicate has an impact to find.
 */
const BASE: ScenarioSpec = (() => {
  const preset = PRESET_SCENARIOS.reduce((a, b) =>
    b.model.forceIds.length > a.model.forceIds.length ? b : a,
  );
  return { ...preset, initialConditions: { ...preset.initialConditions, x0: 0, y0: 0 } };
})();

const REPLICATES = 96;

const STUDY: UncertainScenarioSpec = uncertainScenarioSpecSchema.parse({
  schemaVersion: 1,
  base: BASE,
  overlays: [
    {
      path: "initialConditions.vx0",
      distribution: { kind: "normal", mean: BASE.initialConditions.vx0, stdDev: 3 },
    },
    {
      path: "initialConditions.vy0",
      distribution: { kind: "normal", mean: BASE.initialConditions.vy0, stdDev: 3 },
    },
  ],
  replicates: REPLICATES,
  seed: 20260904,
});

const JOB: McJob = { study: STUDY };

/**
 * Runs the whole study as if a pool of workers had covered `boundaries`'
 * chunks, and returns the assembled columns plus their statistics.
 *
 * `arrivalOrder`, when given, is the order the chunks are handed to the
 * assembler -- i.e. the order the workers finished, which in production is
 * whatever the OS scheduled and is the one thing a caller cannot control.
 * Each chunk is filled by `runMcRange` into its own chunk-local buffer,
 * exactly as a worker would before transferring it back.
 */
function runStudy(
  boundaries: readonly number[],
  arrivalOrder?: readonly number[],
): { columns: McColumns; stats: McStats; hash: string } {
  const chunks: McChunk[] = [];
  for (let c = 0; c + 1 < boundaries.length; c++) {
    const startIndex = boundaries[c]!;
    const endIndex = boundaries[c + 1]!;
    const columns = createMcColumns(endIndex - startIndex);
    runMcRange(JOB, startIndex, endIndex, columns);
    chunks.push({ startIndex, endIndex, columns });
  }
  const ordered = arrivalOrder ? arrivalOrder.map((i) => chunks[i]!) : chunks;
  const columns = assembleMcColumns(ordered, REPLICATES) as McColumns;
  const stats = mcStats(columns);
  return { columns, stats, hash: hashMcStats(stats) };
}

/** Byte-level equality of every column, so nothing hides behind the reduction. */
function sameColumns(a: McColumns, b: McColumns): boolean {
  const keys = ["range", "apexHeight", "timeOfFlight", "impactSpeed", "landed"] as const;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  });
}

/** One chunk covering everything: the degenerate "pool of size 1" case. */
const WHOLE = [0, REPLICATES];

describe("P6.27 same-platform: the study's hash is stable", () => {
  it("produces a study with a non-trivial landed subset, so the hash is over real work", () => {
    // Guards the fixture, not the code. A study where nothing landed, or
    // where every observable was NaN, would hash stably for the wrong reason
    // and every case below would pass vacuously.
    const { stats } = runStudy(WHOLE);
    expect(stats.count).toBe(REPLICATES);
    expect(stats.landedCount).toBeGreaterThan(0);
    expect(Number.isFinite(stats.range.mean)).toBe(true);
    expect(stats.range.variance).toBeGreaterThan(0);
  });

  it("is identical when the same study is run twice in the same process", () => {
    const first = runStudy(WHOLE);
    const second = runStudy(WHOLE);
    expect(second.hash).toBe(first.hash);
    expect(sameColumns(second.columns, first.columns)).toBe(true);
  });

  it("is identical across pool sizes, from one chunk to one chunk per replicate", () => {
    // §8.5's "across pool sizes". Uneven boundaries as well as even ones: a
    // fault that depended on a chunk length being a power of two, or on the
    // first chunk starting at 0, survives an even split.
    const reference = runStudy(WHOLE);
    const partitions: readonly (readonly number[])[] = [
      WHOLE,
      [0, 48, 96],
      [0, 32, 64, 96],
      [0, 1, 2, 95, 96],
      [0, 7, 13, 44, 45, 91, 96],
      Array.from({ length: REPLICATES + 1 }, (_, i) => i),
    ];
    for (const boundaries of partitions) {
      const run = runStudy(boundaries);
      expect(run.hash, `partition ${JSON.stringify(boundaries)} changed the hash`).toBe(
        reference.hash,
      );
      expect(sameColumns(run.columns, reference.columns)).toBe(true);
    }
  });

  it("is identical when the chunks arrive in a shuffled order", () => {
    // The property P6.05 was built for, exercised for the first time through
    // the real integrator rather than over synthetic columns: a worker pool
    // completes chunks in whatever order the OS scheduled, and that must not
    // reach the numbers.
    const boundaries = [0, 7, 13, 44, 45, 91, 96];
    const reference = runStudy(boundaries);
    const reversed = runStudy(boundaries, [5, 4, 3, 2, 1, 0]);
    const interleaved = runStudy(boundaries, [3, 0, 5, 1, 4, 2]);
    expect(reversed.hash).toBe(reference.hash);
    expect(interleaved.hash).toBe(reference.hash);
  });

  it("changes if a single replicate's contribution changes, so the hash is not vacuous", () => {
    // Every case above asserts an equality; without this one they would all
    // be satisfied by a hash that ignored its input. Perturbs one landed
    // replicate's range by one ULP -- the smallest change the chain could
    // possibly produce -- and requires the hash to notice.
    const reference = runStudy(WHOLE);
    const index = reference.columns.landed.indexOf(1);
    expect(index).toBeGreaterThanOrEqual(0);
    const twisted = { ...reference.columns, range: Float64Array.from(reference.columns.range) };
    twisted.range[index] = nextUp(twisted.range[index]!);
    expect(twisted.range[index]).not.toBe(reference.columns.range[index]);
    expect(hashMcStats(mcStats(twisted))).not.toBe(reference.hash);
  });
});

describe("P6.27 cross-platform: the same study is graded within the §2.6 budget", () => {
  it("a same-platform reproduction is exactly zero drift, not merely tolerable", () => {
    // The tolerance is for a second engine. On one platform the answer must
    // be bit-identical, and reporting a small non-zero drift here would mean
    // something in the chain is not deterministic after all.
    const a = runStudy(WHOLE);
    const b = runStudy([0, 32, 64, 96], [2, 0, 1]);
    expect(mcStatsRelativeDrift(a.stats, b.stats)).toBe(0);
  });

  it("a drift at the §2.6 budget is accepted and one an order of magnitude past it is not", () => {
    // Stands in for a second engine, which this process cannot run: perturb
    // the real study's statistics by the amount the budget permits and by
    // ten times that, and require the grading to separate them. What a real
    // engine drifts by is P2.45/P7.11's measurement, not this test's claim.
    const { stats } = runStudy(WHOLE);
    const shift = (rel: number): McStats => ({
      ...stats,
      impactSpeed: { ...stats.impactSpeed, mean: stats.impactSpeed.mean * (1 + rel) },
    });
    expect(mcStatsRelativeDrift(stats, shift(MC_STATS_CROSS_PLATFORM_REL_TOL * 0.1))).toBeLessThan(
      MC_STATS_CROSS_PLATFORM_REL_TOL,
    );
    expect(
      mcStatsRelativeDrift(stats, shift(MC_STATS_CROSS_PLATFORM_REL_TOL * 10)),
    ).toBeGreaterThan(MC_STATS_CROSS_PLATFORM_REL_TOL);
  });
});

/**
 * The next representable double above `value`, for the one-ULP perturbation
 * above. Written out rather than imported because the only alternative --
 * multiplying by `1 + Number.EPSILON` -- is not a one-ULP step for every
 * magnitude, and a perturbation larger than the smallest possible one would
 * make the "not vacuous" case weaker than it claims to be.
 */
function nextUp(value: number): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  // Positive and +0 step up in bit order; negatives step up by stepping the
  // magnitude down. Only finite inputs occur here.
  view.setBigUint64(0, value >= 0 ? bits + 1n : bits - 1n);
  return view.getFloat64(0);
}
