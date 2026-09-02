/**
 * Worker entry for the batch throughput benchmark (P6.26), running inside a
 * `node:worker_threads` Worker spawned by
 * `scripts/measure-batch-throughput.mjs`.
 *
 * The counterpart to `sweep-worker-entry.ts`, and deliberately NOT that
 * file: the sweep entry is a browser Worker (`self.onmessage`, transferable
 * `postMessage`) driven by `worker-pool.ts`, and a CI script cannot spawn
 * one. The two share the shape -- receive an index range, run it, post the
 * columns back -- and nothing else.
 *
 * Kept to one job and no protocol: the parent hands the whole assignment in
 * `workerData` and the worker posts exactly one message. A request/response
 * protocol would be `WorkerPool`'s (`mc` job, P0.119) rather than a
 * benchmark harness's, and inventing a second one here would be the drift
 * that task exists to prevent.
 */

import { parentPort, workerData } from "node:worker_threads";
import { benchmarkStudy } from "./batch-throughput.js";
import { createMcColumns, runMcRange } from "./mc-job.js";

/** The whole assignment, handed over at construction. */
export interface ThroughputWorkerData {
  readonly stepSize: number;
  readonly replicates: number;
  readonly startIndex: number;
  readonly endIndex: number;
}

/** What a worker reports back: its own chunk bounds, and a checksum of what it computed. */
export interface ThroughputWorkerResult {
  readonly startIndex: number;
  readonly endIndex: number;
  /**
   * Sum of the chunk's ranges.
   *
   * Not decoration and not a result: it is what stops the whole measurement
   * being optimizable away. Without a value crossing the thread boundary, a
   * sufficiently clever runtime is entitled to notice that nothing observes
   * the columns and elide work the number is supposed to include. The parent
   * checks it is finite and non-zero.
   */
  readonly rangeChecksum: number;
}

if (parentPort) {
  const data = workerData as ThroughputWorkerData;
  const study = benchmarkStudy(data.stepSize, data.replicates);
  const columns = createMcColumns(data.endIndex - data.startIndex);
  runMcRange({ study }, data.startIndex, data.endIndex, columns);

  let rangeChecksum = 0;
  for (const value of columns.range) rangeChecksum += value;

  const result: ThroughputWorkerResult = {
    startIndex: data.startIndex,
    endIndex: data.endIndex,
    rangeChecksum,
  };
  parentPort.postMessage(result);
}
