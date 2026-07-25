/**
 * Test-only Vite entry (P3.39, see index.html) exposing `window.runSweepPoolTest`:
 * runs a real `SweepJob` through the real worker pool (real browser
 * `Worker`s via `createSweepWorker`) and reports back the sweep's result
 * shape plus a main-thread "long task probe" -- the max gap between a
 * `setInterval(10ms)` heartbeat's ticks while the sweep is in flight. If
 * the sweep actually ran off-main, the heartbeat keeps ticking on
 * schedule throughout; if it instead blocked the main thread (e.g. a
 * regression that ran the sweep synchronously instead of dispatching to
 * workers), the heartbeat would stall for the sweep's whole duration and
 * this gap would spike accordingly -- worker-pool.e2e.test.ts asserts it
 * stays under 50ms.
 */

import { createWorkerPool, type SweepJob, type SweepResult } from "@ballista/runtime";
import { createSweepWorker } from "../sweep-worker-factory.js";

export interface SweepPoolTestResult {
  readonly rangeLength: number;
  readonly apexHeightLength: number;
  readonly maxHeartbeatGapMs: number;
  readonly elapsedMs: number;
}

declare global {
  interface Window {
    runSweepPoolTest: (job: SweepJob) => Promise<SweepPoolTestResult>;
  }
}

window.runSweepPoolTest = async (job: SweepJob): Promise<SweepPoolTestResult> => {
  const size = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const pool = createWorkerPool({ createWorker: createSweepWorker, size });

  const gaps: number[] = [];
  let lastTick = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    gaps.push(now - lastTick);
    lastTick = now;
  }, 10);

  const start = performance.now();
  let result: SweepResult;
  try {
    result = await pool.runSweep(job);
  } finally {
    clearInterval(heartbeat);
    pool.terminate();
  }

  return {
    rangeLength: result.range.length,
    apexHeightLength: result.apexHeight.length,
    maxHeartbeatGapMs: gaps.length > 0 ? Math.max(...gaps) : 0,
    elapsedMs: performance.now() - start,
  };
};
