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
 *
 * P0.119 adds `window.runMcPoolTest` on the same principle and for the same
 * reason: that task's criterion is that the UI thread stays responsive under a
 * 2048-replicate Monte Carlo study, and "responsive" is a property of real
 * threads that no in-process fake can demonstrate. The probe is identical --
 * the study's own duration is what a main-thread regression would show up as.
 */

import {
  createWorkerPool,
  type McDashboardStudySpec,
  type McDashboardResult,
  type SweepJob,
  type SweepResult,
} from "@ballista/runtime";
import { createMcWorker } from "../mc-worker-factory.js";
import { createSweepWorker } from "../sweep-worker-factory.js";

export interface SweepPoolTestResult {
  readonly rangeLength: number;
  readonly apexHeightLength: number;
  readonly maxHeartbeatGapMs: number;
  readonly elapsedMs: number;
}

export interface McPoolTestResult {
  readonly replicates: number;
  readonly rangeLength: number;
  /** Progress reports that carried a partial estimate -- P6.25's live interval. */
  readonly partialCount: number;
  /**
   * How many times the heartbeat actually ticked, and it is NOT diagnostic
   * padding -- without it `maxHeartbeatGapMs` passes on the very defect it
   * exists to catch.
   *
   * A fully blocking study never lets a single `setInterval` callback run, so
   * `gaps` comes back EMPTY and the max-of-empty fallback reports the best
   * possible value, `0`. Measured, not reasoned about: pointing this probe at
   * the synchronous `runMcDashboardStudy` left the e2e assertions green.
   * Requiring a tick count proportional to the elapsed time is what makes a
   * blocked main thread fail, because a blocked thread cannot produce ticks.
   */
  readonly heartbeatTicks: number;
  readonly maxHeartbeatGapMs: number;
  readonly elapsedMs: number;
}

declare global {
  interface Window {
    runSweepPoolTest: (job: SweepJob) => Promise<SweepPoolTestResult>;
    runMcPoolTest: (spec: McDashboardStudySpec) => Promise<McPoolTestResult>;
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

window.runMcPoolTest = async (spec: McDashboardStudySpec): Promise<McPoolTestResult> => {
  // Size 1, matching monte-carlo-route.tsx: a study is a sequential reduction,
  // so the pool contributes a thread rather than parallelism.
  const pool = createWorkerPool({ createWorker: createMcWorker, size: 1 });

  const gaps: number[] = [];
  let lastTick = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    gaps.push(now - lastTick);
    lastTick = now;
  }, 10);

  const start = performance.now();
  let partialCount = 0;
  let result: McDashboardResult;
  try {
    result = await pool.runMc(spec, {
      onProgress: (progress) => {
        if (progress.partial !== undefined) partialCount += 1;
      },
    });
  } finally {
    clearInterval(heartbeat);
    pool.terminate();
  }

  return {
    replicates: spec.study.replicates,
    rangeLength: result.columns.range.length,
    partialCount,
    heartbeatTicks: gaps.length,
    // Still a max-of-empty fallback, but it is no longer load-bearing: the
    // caller asserts `heartbeatTicks` against `elapsedMs`, so an empty `gaps`
    // fails there rather than passing here.
    maxHeartbeatGapMs: gaps.length > 0 ? Math.max(...gaps) : 0,
    elapsedMs: performance.now() - start,
  };
};
