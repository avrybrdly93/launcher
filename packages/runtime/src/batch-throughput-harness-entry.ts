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
export { runMcReplicate } from "./mc-job.js";
