/**
 * The surface `scripts/measure-batch-throughput.mjs` needs, in one entry
 * point for esbuild to bundle (P6.26).
 *
 * It exists because the script cannot import `packages/runtime/dist/*.js`
 * directly: those files import bare workspace specifiers whose package
 * `main` is a `.ts` file, which Node's resolver cannot follow. Bundling is
 * the same answer `measure-cross-engine-drift.mjs` already gives to the same
 * problem, and re-exporting here keeps the script's import list a list of
 * names rather than a list of paths into the package's internals.
 */

export {
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
} from "./batch-throughput.js";
// `createMcColumns` and `runMcRange` are P7.28's addition, for
// `measure-dispatch-crossover.mjs`'s main-thread arm. That arm must run the
// benchmark ensemble *in this process* -- the whole point of the measurement is
// what a job costs with no worker involved -- so it needs the same range entry
// point `batch-throughput-worker-entry.ts` calls inside a worker. Re-exported
// here rather than reached for directly, for this file's stated reason: the
// script's import list stays a list of names.
export { createMcColumns, runMcRange, runMcReplicate } from "./mc-job.js";
