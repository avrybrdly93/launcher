// Dispatch-crossover measurement (P7.28): the replicate count below which
// running an ensemble on the main thread beats handing it to workers.
//
// WHY THIS EXISTS. P7.28 is a routing policy -- job size plus backend
// availability decides where a job runs -- and a routing policy is mostly
// thresholds. P0.131 is open about exactly that shape: three phase-7 tasks
// carry bare throughput thresholds set before anything was measured, and it
// records P7.03 and P7.05 as two-for-two that the shape fails. So the one
// boundary in `scheduler-policy.ts` that CAN be measured in this container is
// measured here rather than chosen, and the constant it grounds says so.
//
// WHAT IS BEING MEASURED, AND WHY IT IS NOT THE SAME QUESTION AS P7.12'S.
// `measure-worker-scaling.mjs` fixes a large job (40000 replicates) and sweeps
// the worker count, asking how well parallelism scales once it is worth having.
// This script asks the prior question -- at what size does it BECOME worth
// having -- and so it sweeps the job SIZE with the worker count fixed, against
// an arm that spawns no worker at all. The two arms are:
//
//   main    the whole ensemble via `runMcRange` in this process, no worker
//   worker  the same ensemble partitioned across WORKER_COUNT real Workers
//
// The crossover is the smallest swept size at which the worker arm is faster.
// Below it, dispatch costs more than the work, which is the entire reason a
// routing policy cannot be "always use the best backend available".
//
// THIS MEASURES WORKER DISPATCH AND SAYS NOTHING ABOUT THE GPU. The GPU arm of
// P7.28's policy routes a job because it is huge, not because a rate was
// measured here; P7.20 owns that number and this script deliberately does not
// produce one. A GPU crossover would need a non-software adapter, and the only
// one reachable in this container is SwiftShader -- see
// `measure-gpu-workgroup-sweep.mjs`'s header, which is the settled reading.
//
// WHAT THE NUMBER IS AND IS NOT. It is machine-dependent: worker startup is an
// OS and runtime cost, and the artifact records the environment for that
// reason. It is NOT a knife edge -- the two arms cross shallowly, so a policy
// boundary near it is a good boundary and a policy boundary exactly on it is
// not meaningfully better. That is why `scheduler-policy.ts` treats the
// measured value as evidence for a rounded declared boundary rather than
// adopting it as a constant, and why nothing in `pnpm test` asserts this timing
// (worker-scaling-decision.test.ts states the convention: a wall-clock
// assertion inside the suite is a flake).
//
// SERIALLY, NEVER CONCURRENTLY, and each arm repeated: the two arms of one size
// run one after another, and each is run REPEATS times with the MINIMUM taken.
// A minimum, not a mean -- at these sizes the quantity is small enough that a
// scheduler hiccup is a large fraction of it, and noise on a shared runner is
// one-sided (it can only make a run slower).
//
// SOFT-WARN, like this repository's other perf checks. There is no criterion to
// miss here -- the script reports where the crossover fell, and a crossover is
// a finding rather than a pass or a fail. It exits 0 unless the measurement
// itself was incoherent.
//
// WRITING IS OPT-IN (P0.102). Pass `--record` to update the committed
// scripts/dispatch-crossover-results.json; without it the script measures and
// reports but touches nothing.
//
// Usage:
//   node scripts/measure-dispatch-crossover.mjs [--record] [--repeats N]

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as esbuild from "esbuild";

const ARTIFACT_PATH = new URL("./dispatch-crossover-results.json", import.meta.url);

/**
 * The job sizes swept, in replicates.
 *
 * Powers of two spanning four orders of magnitude. The bottom of the range is
 * genuinely tiny on purpose: the interesting claim is that a small job is
 * *slower* on workers, and a sweep that started where workers already win could
 * not show it. The top is well past the expected crossover so the curve has a
 * settled side, rather than ending at the moment it turns over.
 */
const REPLICATE_SWEEP = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

/**
 * Workers in the parallel arm. Four, matching §2.6's throughput budget,
 * P7.12's criterion and this container's reported core count -- so the arm
 * measured is the one the app would actually dispatch to.
 */
const WORKER_COUNT = 4;

/**
 * The step size held fixed across the sweep: `measure-batch-throughput.mjs`'s
 * own verdict rung, taken from the committed artifact rather than chosen here,
 * so this sweep measures the same work the other two scripts do.
 */
const FIXED_STEP_SIZE = 0.05;

/** Timed runs per arm per size; the minimum is reported. See the header. */
const DEFAULT_REPEATS = 5;

/**
 * How far the two arms may disagree on the ensemble checksum, relative.
 *
 * Same instrument and same reasoning as `measure-worker-scaling.mjs`'s bound,
 * and for the same reason: a replicate is a pure function of the study seed and
 * its index (P6.03) and reassembly is by index (§5.6), so the *ensemble* is
 * identical in both arms. What differs is the grouping of one floating-point
 * sum -- the main arm adds one partial, the worker arm adds one per chunk -- so
 * the two land a few ULP apart and IEEE addition is not associative. The guard
 * is kept because its real job is to catch an arm that computed a *different*
 * ensemble (a wrong partition, a dropped chunk, an off-by-one), which shows up
 * as orders of magnitude rather than as ULP. The measured spread is recorded on
 * every run, so a later run sees creep rather than inheriting a number.
 */
const CHECKSUM_REASSOCIATION_TOLERANCE = 1e-13;

function parseArgs(argv) {
  const args = { record: false, repeats: DEFAULT_REPEATS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--record") args.record = true;
    else if (arg === "--repeats") args.repeats = Number(argv[++i]);
    else throw new Error(`measure-dispatch-crossover: unknown argument "${arg}"`);
  }
  if (!Number.isInteger(args.repeats) || args.repeats < 1) {
    throw new Error(`measure-dispatch-crossover: --repeats must be a positive integer`);
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
 * The main-thread arm: the whole ensemble in this process, no worker anywhere.
 *
 * The checksum is what stops the measurement being optimizable away -- without
 * a value observed after the run, a sufficiently clever runtime may elide work
 * the timing is supposed to include. It is also half of the cross-arm identity
 * check.
 */
function runMainArm(definition, replicates) {
  const study = definition.benchmarkStudy(FIXED_STEP_SIZE, replicates);
  const columns = definition.createMcColumns(replicates);

  const start = process.hrtime.bigint();
  definition.runMcRange({ study }, 0, replicates, columns);
  const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;

  let checksum = 0;
  for (const value of columns.range) checksum += value;
  return { elapsedSeconds, checksum };
}

/**
 * The worker arm: the same ensemble across {@link WORKER_COUNT} real Workers.
 *
 * Spawn cost is inside the timed region deliberately -- it is the cost the
 * routing decision exists to weigh. A measurement that started the clock after
 * the workers were up would be measuring the thing that is never in doubt.
 *
 * Empty chunks are filtered because `partitionReplicates` can produce them when
 * replicates < workers, and spawning a worker to do nothing would attribute a
 * spawn to work that was never dispatched.
 */
async function runWorkerArm(definition, workerFile, replicates) {
  const chunks = definition
    .partitionReplicates(replicates, WORKER_COUNT)
    .filter((chunk) => chunk.endIndex > chunk.startIndex);

  const start = process.hrtime.bigint();
  const results = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(pathToFileURL(workerFile), {
            workerData: {
              stepSize: FIXED_STEP_SIZE,
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
  const covered = byStart.reduce((sum, r) => sum + (r.endIndex - r.startIndex), 0);
  if (covered !== replicates) {
    throw new Error(
      `measure-dispatch-crossover: the worker arm covered ${covered} of ${replicates} replicates`,
    );
  }
  const checksum = byStart.reduce((sum, r) => sum + r.rangeChecksum, 0);
  return { elapsedSeconds, checksum, chunks: chunks.length };
}

/** Repeats an arm and keeps its fastest run. See the header on minimum-vs-mean. */
async function best(repeats, run) {
  let bestResult;
  for (let i = 0; i < repeats; i++) {
    const result = await run();
    if (bestResult === undefined || result.elapsedSeconds < bestResult.elapsedSeconds) {
      bestResult = result;
    }
  }
  return bestResult;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outDir = mkdtempSync(join(tmpdir(), "ballista-crossover-"));
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
    for (const replicates of REPLICATE_SWEEP) {
      // Serially, one arm at a time -- see the module header.
      const mainArm = await best(args.repeats, () =>
        Promise.resolve(runMainArm(definition, replicates)),
      );
      const workerArm = await best(args.repeats, () =>
        runWorkerArm(definition, workerFile, replicates),
      );

      const spread =
        Math.abs(workerArm.checksum - mainArm.checksum) / Math.abs(mainArm.checksum || 1);
      if (!(spread <= CHECKSUM_REASSOCIATION_TOLERANCE)) {
        throw new Error(
          `measure-dispatch-crossover: at ${replicates} replicates the two arms disagreed on the ensemble checksum by ${spread.toExponential(3)} relative (main ${mainArm.checksum}, worker ${workerArm.checksum}), above the ${CHECKSUM_REASSOCIATION_TOLERANCE.toExponential(0)} reassociation bound. That is too large to be the grouping of the chunk partials, so the two arms are computing different ensembles -- root-cause it; do not widen this bound.`,
        );
      }

      points.push({
        replicates,
        chunks: workerArm.chunks,
        mainThreadSeconds: mainArm.elapsedSeconds,
        workerSeconds: workerArm.elapsedSeconds,
        workerSpeedup: mainArm.elapsedSeconds / workerArm.elapsedSeconds,
        checksumRelativeSpread: spread,
      });
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // The crossover is the smallest swept size at which the worker arm wins, and
  // it is reported as `null` rather than as a number when no swept size does.
  // A script that returned the top of its own sweep in that case would be
  // reporting the sweep's edge as if it were a measurement.
  const crossing = points.find((point) => point.workerSpeedup > 1);
  const crossoverReplicates = crossing === undefined ? null : crossing.replicates;

  const artifact = {
    task: "P7.28",
    measures:
      "the replicate count at which dispatching an ensemble to workers becomes faster than running it on the main thread",
    doesNotMeasure:
      "any GPU rate. The GPU arm of P7.28's policy routes by job size, not by a measured throughput; P7.20 owns that number and this container has only a software adapter.",
    mechanism: "message-passing workers (node:worker_threads); spawn cost inside the timed region",
    workers: WORKER_COUNT,
    stepSize: FIXED_STEP_SIZE,
    repeatsPerArm: args.repeats,
    statistic: "minimum of the repeats, per arm",
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
    },
    checksumReassociationTolerance: CHECKSUM_REASSOCIATION_TOLERANCE,
    points,
    verdict: {
      crossoverReplicates,
      sweptRange: { lowest: REPLICATE_SWEEP[0], highest: REPLICATE_SWEEP.at(-1) },
    },
  };

  for (const point of points) {
    console.log(
      `${String(point.replicates).padStart(5)} replicates: ` +
        `main ${(point.mainThreadSeconds * 1e3).toFixed(2)} ms, ` +
        `${point.chunks} worker(s) ${(point.workerSeconds * 1e3).toFixed(2)} ms, ` +
        `worker speedup ${point.workerSpeedup.toFixed(3)}x` +
        (point.workerSpeedup > 1 ? "  <- workers win" : ""),
    );
  }

  if (crossoverReplicates === null) {
    console.log(
      `::warning::Workers never overtook the main thread anywhere in ${REPLICATE_SWEEP[0]}..${REPLICATE_SWEEP.at(-1)} replicates. That is a finding, not a failure: it means the crossover is above this sweep on this machine. Widen REPLICATE_SWEEP before reading anything else into it.`,
    );
  } else {
    console.log(
      `::notice::Workers overtake the main thread at ${crossoverReplicates} replicates on ${cpus().length} reported CPUs. This grounds P7.28's small/medium policy boundary; it is evidence for a rounded boundary, not a constant to adopt verbatim -- the arms cross shallowly.`,
    );
  }

  if (args.record) {
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`measure-dispatch-crossover: recorded ${ARTIFACT_PATH.pathname}`);
  }
}

await main();
