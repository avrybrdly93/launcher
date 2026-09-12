// Worker-scaling measurement (P7.12), against that task's criterion:
// "4-thread WASM scales >=2.5x (or documented decision to defer)".
//
// WHY THIS EXISTS AT ALL, GIVEN THE TASK NAMES *THREADS*. The criterion's
// subject is a number -- does four-way parallelism buy >=2.5x -- and wasm
// threads are one mechanism for reaching it, not the only one. This ensemble
// workload partitions by replicate index into contiguous chunks that share no
// mutable state (`partitionReplicates`, reassembled by each chunk's own
// `startIndex`, §5.6), so what it needs is N execution contexts, and
// message-passing workers already are that. Shared linear memory would remove
// a buffer hand-off, not add a core. So the number the criterion asks for is
// measurable today, on the path that already ships, with no
// `SharedArrayBuffer` and no COOP/COEP anywhere. This script measures it, and
// ADR-020 is the decision it feeds.
//
// WHAT THIS OWNS AND WHAT IT DOES NOT, the same split
// measure-batch-throughput.mjs draws: the benchmark's *definition* -- the
// scenario, the solver, the partition, the checksum rule -- lives in
// packages/runtime/src/batch-throughput.ts and is imported here. This file
// owns only the worker-count sweep, the clock and the artifact. It shares
// batch-throughput's worker entry verbatim rather than growing a second one,
// which is what makes "the same work, on a different number of threads" a
// true statement about this measurement rather than a hope.
//
// THE AXIS IS THE ONLY DIFFERENCE FROM measure-batch-throughput.mjs, and it
// is the whole point. That script sweeps the *step ladder* at a fixed four
// workers and reads a throughput verdict. This one fixes the step at that
// script's own verdict rung and sweeps the *worker count*, so the quantity
// reported is a ratio rather than an absolute. A ratio is the honest thing to
// report from a shared CI runner: absolute throughput moves with the
// neighbour, and both numerator and denominator move with it together.
//
// SERIALLY, NEVER CONCURRENTLY. The three worker counts run one after
// another, because a 1-worker run sharing a machine with a 4-worker run is
// measuring the scheduler, not the scaling. That is also why this script is
// not part of `pnpm test`.
//
// SOFT-WARN, like this repository's other perf checks
// (check-benchmark-regression.mjs, measure-batch-throughput.mjs,
// measure-cross-engine-drift.mjs). A missed ratio prints `::warning::` and
// exits 0: a scaling number on a shared runner with an unknown core count is
// not a signal a build should be gated on. The artifact is the deliverable;
// the exit code is not the evidence. ADR-020 records the measurement that was
// made on a known machine, and `worker-scaling-decision.test.ts` is what
// actually gates the decision's premises.
//
// WRITING IS OPT-IN (P0.102). Pass `--record` to update the committed
// scripts/worker-scaling-results.json; without it the script measures and
// reports but touches nothing.
//
// Usage:
//   node scripts/measure-worker-scaling.mjs [--record] [--replicates N]

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as esbuild from "esbuild";

const ARTIFACT_PATH = new URL("./worker-scaling-results.json", import.meta.url);

/** Same default as measure-batch-throughput.mjs, and for the same reason: below this, spawn cost dominates and the script reports startup rather than throughput. */
const DEFAULT_REPLICATES = 40_000;

/**
 * The worker counts swept. 1 is the denominator; 4 is the count §2.6 states
 * the throughput budget at and the count P7.12's criterion names; 2 is in
 * between so that a result can be read as a curve rather than as two points,
 * which is what distinguishes real scaling from a one-off.
 */
const WORKER_COUNTS = [1, 2, 4];

/**
 * The step size held fixed across the sweep. This is
 * measure-batch-throughput.mjs's own verdict rung -- the coarsest step inside
 * `ACCURACY_CEILING` -- taken from the committed artifact rather than chosen
 * here, so the two scripts measure the same work.
 */
const FIXED_STEP_SIZE = 0.05;

/** P7.12's criterion. Not a gate (see the soft-warn note above); the number the report is read against. */
const TARGET_SPEEDUP = 2.5;

/**
 * How far the cross-partition checksums may spread, relative.
 *
 * **This is not a physics tolerance and the ensemble is not approximate.** A
 * replicate is a pure function of the study seed and its index (P6.03) and
 * reassembly is by index (§5.6), so the *ensemble* is bit-identical at every
 * worker count -- `batch-throughput.test.ts` asserts exactly that,
 * element-wise, under three partitions. What differs here is the **grouping
 * of one floating-point sum**: this script's guard adds up one partial per
 * chunk, and the chunk count is the worker count, so 1, 2 and 4 workers add
 * the same values in three different associations. IEEE addition is not
 * associative, so they land a few ULP apart. The first run of this script
 * measured **10085718.86165591 / ...924 / ...928**, a relative spread of
 * **1.8e-15** and about 8 ULP.
 *
 * The guard is kept rather than dropped because its real job is to catch a
 * sweep that computed three *different* ensembles -- a wrong partition, a
 * dropped chunk, an off-by-one -- which shows up as orders of magnitude, not
 * ULP. 1e-13 is ~450 ULP here: far above the reassociation floor measured
 * above, far below anything a real defect could hide in. The measured spread
 * is recorded in the artifact on every run, so if it ever starts creeping
 * towards this bound a later run sees it rather than inheriting a number.
 *
 * **A relative tolerance is the right instrument here, and the 95th run's
 * finding says when it is not.** That run found a relative gate unstable
 * because it divided by a `vy` the model drives through zero. This checksum
 * is a sum of 40000 strictly positive ranges, ~1e7, with no zero crossing
 * anywhere near it -- the denominator cannot collapse. The distinction is the
 * whole content of that finding and is why it was worth writing down.
 */
const CHECKSUM_REASSOCIATION_TOLERANCE = 1e-13;

function parseArgs(argv) {
  const args = { record: false, replicates: DEFAULT_REPLICATES };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--record") args.record = true;
    else if (arg === "--replicates") args.replicates = Number(argv[++i]);
    else throw new Error(`measure-worker-scaling: unknown argument "${arg}"`);
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

/**
 * One point of the sweep: the same `replicates` at the same `stepSize`, split
 * across `workers` real threads.
 *
 * The checksum is what stops the measurement being optimizable away, and here
 * it does a second job the single-worker-count script cannot ask of it: it
 * must come out **the same at every worker count**, because a replicate is a
 * pure function of the study seed and its index (P6.03) and reassembly is by
 * index (§5.6). A sweep whose checksum moved with the thread count would be
 * measuring three different computations and its ratio would mean nothing.
 *
 * "The same" is not "bit-identical", and the first run of this script is what
 * established the difference. The checksum sums one partial **per chunk**, and
 * the chunk count *is* the worker count, so the three points sum the same
 * values in three different associations and land ~8 ULP apart. The ensemble
 * itself is bit-identical; only this reduction's grouping moves. See
 * {@link CHECKSUM_REASSOCIATION_TOLERANCE}, which carries the measured spread
 * and the reason the bound is where it is.
 */
async function measurePoint(definition, workerFile, stepSize, replicates, workers) {
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

  const byStart = [...results].sort((a, b) => a.startIndex - b.startIndex);
  const checksum = byStart.reduce((sum, result) => sum + result.rangeChecksum, 0);
  if (!Number.isFinite(checksum) || checksum === 0) {
    throw new Error(
      `measure-worker-scaling: ${workers} workers produced a checksum of ${checksum}; they did not compute a real ensemble`,
    );
  }
  const covered = byStart.reduce((sum, result) => sum + (result.endIndex - result.startIndex), 0);
  if (covered !== replicates) {
    throw new Error(
      `measure-worker-scaling: ${workers} workers covered ${covered} of ${replicates} replicates`,
    );
  }

  return {
    workers,
    chunks: chunks.length,
    elapsedSeconds,
    trajectoriesPerSecond: replicates / elapsedSeconds,
    checksum,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outDir = mkdtempSync(join(tmpdir(), "ballista-scaling-"));
  let points;
  try {
    const definitionFile = await bundle(
      outDir,
      "../packages/runtime/src/batch-throughput-harness-entry.ts",
      "definition.mjs",
    );
    const definition = await import(pathToFileURL(definitionFile).href);
    const workerFile = await bundle(
      outDir,
      "../packages/runtime/src/batch-throughput-worker-entry.ts",
      "worker.mjs",
    );

    points = [];
    for (const workers of WORKER_COUNTS) {
      // Serially, one await at a time -- see the module header.
      points.push(
        await measurePoint(definition, workerFile, FIXED_STEP_SIZE, args.replicates, workers),
      );
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // Every point must have computed the same ensemble. See measurePoint and
  // CHECKSUM_REASSOCIATION_TOLERANCE -- what is compared is the checksum's
  // *spread*, because the number of chunks summed is the worker count and
  // IEEE addition is not associative.
  const checksums = points.map((point) => point.checksum);
  const lowest = Math.min(...checksums);
  const highest = Math.max(...checksums);
  const checksumRelativeSpread = (highest - lowest) / Math.abs(lowest);
  if (!(checksumRelativeSpread <= CHECKSUM_REASSOCIATION_TOLERANCE)) {
    throw new Error(
      `measure-worker-scaling: worker counts disagreed on the ensemble checksum by ${checksumRelativeSpread.toExponential(3)} relative (${checksums.join(", ")}), above the ${CHECKSUM_REASSOCIATION_TOLERANCE.toExponential(0)} reassociation bound. That is too large to be the grouping of the chunk partials, so the sweep is measuring more than one computation -- root-cause it; do not widen this bound.`,
    );
  }

  const baseline = points.find((point) => point.workers === 1);
  const scaled = points.map((point) => ({
    workers: point.workers,
    chunks: point.chunks,
    elapsedSeconds: point.elapsedSeconds,
    trajectoriesPerSecond: point.trajectoriesPerSecond,
    speedupOverOneWorker: point.trajectoriesPerSecond / baseline.trajectoriesPerSecond,
    parallelEfficiency:
      point.trajectoriesPerSecond / baseline.trajectoriesPerSecond / point.workers,
  }));
  const four = scaled.find((point) => point.workers === 4);

  const artifact = {
    task: "P7.12",
    criterion: {
      speedup: TARGET_SPEEDUP,
      workers: 4,
      source: "blueprint §7 P7.12 validation column",
    },
    mechanism:
      "message-passing workers (node:worker_threads); no SharedArrayBuffer, no wasm threads",
    stepSize: FIXED_STEP_SIZE,
    replicates: args.replicates,
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
    },
    checksum: {
      perWorkerCount: Object.fromEntries(points.map((point) => [point.workers, point.checksum])),
      relativeSpread: checksumRelativeSpread,
      reassociationTolerance: CHECKSUM_REASSOCIATION_TOLERANCE,
    },
    points: scaled,
    verdict: {
      speedupAtFourWorkers: four.speedupOverOneWorker,
      meetsCriterion: four.speedupOverOneWorker >= TARGET_SPEEDUP,
    },
  };

  for (const point of scaled) {
    console.log(
      `${point.workers} worker(s): ${point.trajectoriesPerSecond.toFixed(0)} traj/s ` +
        `(${point.elapsedSeconds.toFixed(3)} s), speedup ${point.speedupOverOneWorker.toFixed(3)}x, ` +
        `efficiency ${(point.parallelEfficiency * 100).toFixed(1)}%`,
    );
  }

  if (artifact.verdict.meetsCriterion) {
    console.log(
      `::notice::Message-passing workers scale ${four.speedupOverOneWorker.toFixed(2)}x at 4 workers, meeting P7.12's >=${TARGET_SPEEDUP}x without SharedArrayBuffer. See ADR-020.`,
    );
  } else {
    console.log(
      `::warning::Message-passing workers scale ${four.speedupOverOneWorker.toFixed(2)}x at 4 workers, BELOW P7.12's >=${TARGET_SPEEDUP}x. Soft-warn: a scaling ratio on a shared runner with ${cpus().length} reported CPUs is not a build gate. If this reproduces on an idle machine with >=4 cores, ADR-020's premise has failed and the deferral needs re-arguing.`,
    );
  }

  if (args.record) {
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`measure-worker-scaling: recorded ${ARTIFACT_PATH.pathname}`);
  }
}

await main();
