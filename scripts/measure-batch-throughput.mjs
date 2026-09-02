// Batch throughput measurement (P6.26), against §2.6's CPU budget:
// "≥1e4 full trajectories/s (RK4, fixed step, typical flight) on 4 workers
// by end of Phase 6".
//
// WHAT THIS SCRIPT OWNS, and what it deliberately does not. The benchmark's
// *definition* -- which scenario, which solver, the step ladder, the
// partition, the verdict rule -- lives in
// packages/runtime/src/batch-throughput.ts, where the test suite can assert
// it without spawning a thread. This file owns only the threads, the clock
// and the artifact. That split is the same one worker-pool.ts draws against
// sweep-job.ts, and it is what makes the accuracy claim testable.
//
// WHY node:worker_threads AND NOT WorkerPool. `worker-pool.ts` dispatches to
// browser `Worker`s over `postMessage`; a CI script has no DOM and cannot
// construct one. The pool's *policy* is reproduced rather than its
// mechanism: contiguous index-addressed chunks, reassembled by each chunk's
// own start index and never by arrival order (§5.6). Since a replicate is a
// pure function of the study seed and its index (P6.03), that policy is what
// makes the measured ensemble independent of the worker count -- asserted in
// batch-throughput.test.ts under three different partitions.
//
// WHY esbuild. The workspace packages resolve through bare specifiers
// (`@ballista/engine`) that Node cannot follow to a `.ts` main, so the worker
// entry is bundled into one ESM file first -- exactly what
// measure-cross-engine-drift.mjs does to get repo TypeScript into a browser.
// The bundle is written under the OS temp directory and removed afterwards;
// nothing about it is committed.
//
// THE STEP SIZE IS THE ONE KNOB THAT DECIDES PASS/FAIL, so this script does
// not have one. It measures every rung of the ladder, records the accuracy
// AND the throughput of each, and reads the verdict at the coarsest rung
// inside the accuracy ceiling. The whole trade-off is in the artifact, so a
// reader can see what any other step would have given, and a future run
// cannot quietly move the constant that decides the outcome.
//
// SOFT-WARN, LIKE THIS REPOSITORY'S OTHER TWO PERF CHECKS. A missed budget
// prints `::warning::` and exits 0. Absolute throughput on a shared CI runner
// is not a signal a build should be gated on -- the same reasoning
// check-benchmark-regression.mjs and measure-cross-engine-drift.mjs already
// carry -- and a perf gate that fails for a noisy neighbour trains everyone
// to re-run until it passes. The *artifact* is the deliverable; the exit
// code is not the evidence.
//
// WRITING IS OPT-IN (P0.102). Pass `--record` to update the committed
// scripts/batch-throughput-results.json; without it the script measures and
// reports but touches nothing. A `--record` run still refuses to write a
// result with no eligible rung: recording "we could not tell" over a real
// measurement is never the useful outcome.
//
// Requires packages/*/dist only indirectly -- esbuild reads the TypeScript
// sources directly, so this script does NOT need `pnpm typecheck` to have
// run first.
//
// Usage:
//   node scripts/measure-batch-throughput.mjs [--record] [--replicates N] [--workers W]

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as esbuild from "esbuild";

// The definition module is bundled and imported at runtime rather than
// imported statically: `packages/runtime/dist/*.js` resolves its imports
// through bare workspace specifiers (`@ballista/engine`) whose package
// `main` is a `.ts` file, which Node cannot follow. esbuild can, so both the
// definition and the worker entry go through it.

const ARTIFACT_PATH = new URL("./batch-throughput-results.json", import.meta.url);

/**
 * Replicates per rung. Large enough that worker startup (~50-100 ms each) is
 * a small share of the measurement rather than most of it -- measured: at
 * 4000 replicates the same configuration reports ~5.3e3 traj/s and at 40000
 * it reports ~9.4e3, and the difference is entirely spawn cost being
 * amortized. A benchmark whose number moves that much with N is reporting
 * startup, not throughput.
 */
const DEFAULT_REPLICATES = 40_000;

/**
 * §2.6 states the budget at four workers, so that is the default. Kept here
 * rather than read from the definition module because argument parsing has
 * to happen before the bundle exists.
 */
const DEFAULT_WORKERS = 4;

function parseArgs(argv) {
  const args = { record: false, replicates: DEFAULT_REPLICATES, workers: DEFAULT_WORKERS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--record") args.record = true;
    else if (arg === "--replicates") args.replicates = Number(argv[++i]);
    else if (arg === "--workers") args.workers = Number(argv[++i]);
    else throw new Error(`measure-batch-throughput: unknown argument "${arg}"`);
  }
  return args;
}

/** Bundles one repo TypeScript entry into a single ESM file Node can run. */
async function bundle(outDir, sourceRelative, name) {
  const outfile = join(outDir, name);
  await esbuild.build({
    entryPoints: [new URL(sourceRelative, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "warning",
  });
  return outfile;
}

/** Runs one rung on `workers` real threads and returns the wall-clock elapsed seconds. */
async function measureRung(definition, workerFile, stepSize, replicates, workers) {
  const chunks = definition
    .partitionReplicates(replicates, workers)
    .filter((chunk) => chunk.endIndex > chunk.startIndex);

  const start = process.hrtime.bigint();
  const results = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(pathToFileURL(workerFile), {
            workerData: {
              stepSize,
              replicates,
              startIndex: chunk.startIndex,
              endIndex: chunk.endIndex,
            },
          });
          worker.once("message", (message) => {
            void worker.terminate();
            resolve(message);
          });
          worker.once("error", reject);
        }),
    ),
  );
  const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;

  // The checksum is what stops the measurement being optimizable away: a
  // value has to cross the thread boundary or nothing observes the columns.
  // Reassembled by each chunk's own start index, never by arrival order.
  const byStart = [...results].sort((a, b) => a.startIndex - b.startIndex);
  const checksum = byStart.reduce((sum, result) => sum + result.rangeChecksum, 0);
  if (!Number.isFinite(checksum) || checksum === 0) {
    throw new Error(
      `measure-batch-throughput: step ${stepSize} produced a checksum of ${checksum}; the workers did not compute a real ensemble`,
    );
  }
  const covered = byStart.reduce((sum, result) => sum + (result.endIndex - result.startIndex), 0);
  if (covered !== replicates) {
    throw new Error(
      `measure-batch-throughput: workers covered ${covered} of ${replicates} replicates`,
    );
  }

  return { elapsedSeconds, checksum };
}

/**
 * Relative error in one replicate's range against the tight adaptive
 * reference. Single-threaded and on the main thread on purpose: this is an
 * accuracy measurement, so it must not share a core with the timing run.
 */
function measureAccuracy(definition, stepSize, reference) {
  const result = definition.runMcReplicate({ study: definition.benchmarkStudy(stepSize, 1) }, 0);
  return Math.abs(result.range - reference.range) / Math.abs(reference.range);
}

function formatRate(rate) {
  return `${rate.toFixed(0)} traj/s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outDir = mkdtempSync(join(tmpdir(), "ballista-throughput-"));
  let rungs;
  let definition;
  try {
    const definitionFile = await bundle(
      outDir,
      "../packages/runtime/src/batch-throughput-harness-entry.ts",
      "definition.mjs",
    );
    definition = await import(pathToFileURL(definitionFile).href);
    const workerFile = await bundle(
      outDir,
      "../packages/runtime/src/batch-throughput-worker-entry.ts",
      "worker.mjs",
    );

    const reference = definition.runMcReplicate(
      { study: definition.benchmarkReferenceStudy(1) },
      0,
    );

    rungs = [];
    for (const stepSize of definition.THROUGHPUT_STEP_LADDER) {
      const relativeRangeError = measureAccuracy(definition, stepSize, reference);
      const { elapsedSeconds } = await measureRung(
        definition,
        workerFile,
        stepSize,
        args.replicates,
        args.workers,
      );
      const measurement = definition.throughputFrom(
        stepSize,
        args.replicates,
        args.workers,
        elapsedSeconds,
      );
      rungs.push({ ...measurement, relativeRangeError });
      console.log(
        `  h=${stepSize}  relRangeError=${relativeRangeError.toExponential(3)}  ` +
          `${formatRate(measurement.trajectoriesPerSecond)}  (${elapsedSeconds.toFixed(2)} s)`,
      );
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const verdict = definition.verdictRung(rungs);
  const record = {
    task: "P6.26",
    budget: {
      trajectoriesPerSecond: definition.THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND,
      workers: definition.THROUGHPUT_WORKERS,
      source: "blueprint §2.6, Batch throughput (CPU)",
    },
    accuracyCeiling: definition.ACCURACY_CEILING,
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: (await import("node:os")).cpus().length,
    },
    replicates: args.replicates,
    workers: args.workers,
    ladder: rungs,
    verdict: verdict
      ? {
          stepSize: verdict.stepSize,
          trajectoriesPerSecond: verdict.trajectoriesPerSecond,
          relativeRangeError: verdict.relativeRangeError,
          meetsBudget: definition.meetsBudget(verdict),
        }
      : null,
  };

  if (!verdict) {
    console.log(
      `::warning::No step on the ladder reached the ${definition.ACCURACY_CEILING.toExponential(0)} accuracy ceiling, so there is no throughput to compare against §2.6. This is not a budget failure -- it is a ladder that cannot support a verdict.`,
    );
  } else if (definition.meetsBudget(verdict)) {
    console.log(
      `::notice::Batch throughput ${formatRate(verdict.trajectoriesPerSecond)} on ${args.workers} workers at h=${verdict.stepSize} (relative range error ${verdict.relativeRangeError.toExponential(3)}) meets §2.6's ${definition.THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND} traj/s budget.`,
    );
  } else {
    console.log(
      `::warning::Batch throughput ${formatRate(verdict.trajectoriesPerSecond)} on ${args.workers} workers at h=${verdict.stepSize} is BELOW §2.6's ${definition.THROUGHPUT_BUDGET_TRAJECTORIES_PER_SECOND} traj/s budget. Soft-warn: absolute throughput on a shared runner is not a build gate; the artifact is the record.`,
    );
  }

  if (args.record) {
    if (!verdict) {
      console.log(
        "::warning::--record given, but nothing was measured that supports a verdict; the committed artifact is left alone.",
      );
    } else {
      writeFileSync(ARTIFACT_PATH, `${JSON.stringify(record, null, 2)}\n`);
      console.log(`Recorded ${ARTIFACT_PATH.pathname}`);
    }
  } else {
    // Always print the record, recorded or not, so a CI log carries the same
    // numbers the artifact would.
    console.log(JSON.stringify(record, null, 2));
    try {
      const previous = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
      if (previous.verdict && verdict) {
        const ratio = verdict.trajectoriesPerSecond / previous.verdict.trajectoriesPerSecond;
        console.log(
          `Committed record: ${formatRate(previous.verdict.trajectoriesPerSecond)} at h=${previous.verdict.stepSize} (${previous.environment?.cpus ?? "?"} CPUs). This run is ${ratio.toFixed(2)}x that.`,
        );
      }
    } catch {
      // No committed record yet; nothing to compare against.
    }
  }
}

await main();
