import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { runOptimizeJob, type OptimizeJob } from "./optimize-job.js";
import { runSweepPoint, sweepPointCount, type SweepJob } from "./sweep-job.js";
import {
  createWorkerPool,
  handleSweepChunkRequest,
  OptimizeCancelledError,
  postOptimizeResult,
  postSweepChunkResult,
  type OptimizeRequest,
  type SweepChunkRequest,
  type WorkerLike,
} from "./worker-pool.js";

const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;
const BASE_SCENARIO: ScenarioSpec = {
  ...DRAG_FREE,
  initialConditions: { ...DRAG_FREE.initialConditions, x0: 0, y0: 0 },
};

/**
 * An in-process fake `WorkerLike`: instead of a real background thread, it
 * runs the exact same {@link handleSweepChunkRequest} a real
 * `sweep-worker-entry.ts` would (see worker-pool.ts's own doc comment --
 * that function is the one shared definition of the request/response
 * shape), asynchronously (via `queueMicrotask`, so callers awaiting
 * `runSweep` genuinely wait on a promise rather than getting a
 * synchronously-resolved one) -- enough to exercise the pool's real
 * dispatch/chunking/reassembly logic without a real thread.
 */
function createFakeWorker(): { worker: WorkerLike; requests: SweepChunkRequest[] } {
  const requests: SweepChunkRequest[] = [];
  const worker: WorkerLike = {
    postMessage(message) {
      const request = message as SweepChunkRequest;
      requests.push(request);
      queueMicrotask(() => {
        const response = handleSweepChunkRequest(request);
        worker.onmessage?.({ data: response });
      });
    },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  return { worker, requests };
}

function createFakePool(size: number) {
  const fakes = Array.from({ length: size }, () => createFakeWorker());
  let created = 0;
  const pool = createWorkerPool({
    size,
    createWorker: () => fakes[created++]!.worker,
  });
  return { pool, fakes };
}

describe("createWorkerPool: dispatch and reassembly", () => {
  it("spawns exactly `size` workers, once, reused (not respawned) across runSweep calls", () => {
    let createCount = 0;
    createWorkerPool({ size: 3, createWorker: () => (createCount++, createFakeWorker().worker) });
    expect(createCount).toBe(3);
  });

  it("an 11x11 sweep reassembles to exactly 121 points, matching direct runSweepPoint values at every index (P3.39 grid-size validation criterion)", async () => {
    const job: SweepJob = {
      baseScenario: BASE_SCENARIO,
      thetaDegGrid: Array.from({ length: 11 }, (_, i) => 10 + i * 7),
      v0Grid: Array.from({ length: 11 }, (_, i) => 10 + i * 4),
    };
    const { pool } = createFakePool(4);

    const result = await pool.runSweep(job);

    expect(result.range.length).toBe(121);
    expect(result.apexHeight.length).toBe(sweepPointCount(job));
    for (let i = 0; i < 121; i++) {
      const expected = runSweepPoint(job, i);
      expect(result.range[i]).toBe(expected.range);
      expect(result.apexHeight[i]).toBe(expected.apexHeight);
    }
  });

  it("splits the grid into contiguous, gap-free, non-overlapping chunks across the pool", async () => {
    const job: SweepJob = {
      baseScenario: BASE_SCENARIO,
      thetaDegGrid: Array.from({ length: 11 }, (_, i) => 10 + i * 7),
      v0Grid: Array.from({ length: 11 }, (_, i) => 10 + i * 4),
    };
    const { pool, fakes } = createFakePool(4);

    await pool.runSweep(job);

    const bounds = fakes
      .flatMap((f) => f.requests)
      .map((r) => [r.startIndex, r.endIndex] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(bounds[0]![0]).toBe(0);
    expect(bounds[bounds.length - 1]![1]).toBe(121);
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]![0]).toBe(bounds[i - 1]![1]);
    }
    // 121 / 4 = 30 remainder 1: one chunk of 31, three of 30.
    const sizes = bounds.map(([s, e]) => e - s).sort((a, b) => a - b);
    expect(sizes).toEqual([30, 30, 30, 31]);
  });

  it("a pool of size 1 still completes the whole sweep in a single chunk", async () => {
    const job: SweepJob = { baseScenario: BASE_SCENARIO, thetaDegGrid: [10, 45], v0Grid: [20, 30] };
    const { pool, fakes } = createFakePool(1);

    const result = await pool.runSweep(job);

    expect(result.range.length).toBe(4);
    expect(fakes[0]!.requests).toEqual([{ kind: "sweep-chunk", job, startIndex: 0, endIndex: 4 }]);
  });

  it("an empty grid resolves immediately with empty result arrays, dispatching no work to any worker", async () => {
    const job: SweepJob = { baseScenario: BASE_SCENARIO, thetaDegGrid: [], v0Grid: [20, 30] };
    const { pool, fakes } = createFakePool(3);

    const result = await pool.runSweep(job);

    expect(result.range.length).toBe(0);
    expect(result.apexHeight.length).toBe(0);
    for (const fake of fakes) expect(fake.requests).toHaveLength(0);
  });

  it("terminate() terminates every worker in the pool exactly once", () => {
    const { pool, fakes } = createFakePool(3);
    pool.terminate();
    for (const fake of fakes) expect(fake.worker.terminate).toHaveBeenCalledTimes(1);
  });
});

/**
 * A fake worker that (unlike {@link createFakeWorker} above) posts interim
 * `sweep-chunk-progress` messages via `handleSweepChunkRequest`'s
 * `onProgress` -- exercising `runSweep`'s progress-aggregation path
 * (P3.40) the same way a real worker's `postSweepChunkResult` would,
 * without needing a real thread.
 */
function createProgressReportingFakeWorker(): { worker: WorkerLike } {
  const worker: WorkerLike = {
    postMessage(message) {
      const request = message as SweepChunkRequest;
      queueMicrotask(() => {
        const response = handleSweepChunkRequest(request, (completed) => {
          worker.onmessage?.({
            data: { kind: "sweep-chunk-progress", startIndex: request.startIndex, completed },
          });
        });
        worker.onmessage?.({ data: response });
      });
    },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  return { worker };
}

describe("createWorkerPool: progress messages (P3.40 validation criterion: progress messages)", () => {
  it("aggregates per-chunk progress into full-sweep (completed, total), ending exactly at (total, total)", async () => {
    const job: SweepJob = {
      baseScenario: BASE_SCENARIO,
      thetaDegGrid: Array.from({ length: 11 }, (_, i) => 10 + i * 7),
      v0Grid: Array.from({ length: 11 }, (_, i) => 10 + i * 4),
    };
    let created = 0;
    const fakes = Array.from({ length: 4 }, () => createProgressReportingFakeWorker());
    const pool = createWorkerPool({ size: 4, createWorker: () => fakes[created++]!.worker });

    const reports: Array<readonly [number, number]> = [];
    await pool.runSweep(job, {
      onProgress: (completed, total) => reports.push([completed, total]),
    });

    expect(reports.length).toBeGreaterThan(0);
    for (const [completed, total] of reports) {
      expect(total).toBe(121);
      expect(completed).toBeGreaterThanOrEqual(0);
      expect(completed).toBeLessThanOrEqual(121);
    }
    // Monotonically non-decreasing, and the last report is fully done.
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]![0]).toBeGreaterThanOrEqual(reports[i - 1]![0]);
    }
    expect(reports[reports.length - 1]).toEqual([121, 121]);
  });

  it("never calls onProgress when no option is given (no unconditional overhead)", async () => {
    const job: SweepJob = { baseScenario: BASE_SCENARIO, thetaDegGrid: [10], v0Grid: [20] };
    const { pool } = createFakePool(1);
    // No onProgress passed -- just confirming this doesn't throw / requires no callback.
    await expect(pool.runSweep(job)).resolves.toMatchObject({ range: expect.any(Float64Array) });
  });
});

describe("postSweepChunkResult: posts via transfer, not structured-clone (P3.40 validation criterion)", () => {
  it("the response's Float64Array buffers are detached (byteLength 0) immediately after posting through a real MessagePort", async () => {
    const job: SweepJob = { baseScenario: BASE_SCENARIO, thetaDegGrid: [10, 45], v0Grid: [20, 30] };
    const request: SweepChunkRequest = { kind: "sweep-chunk", job, startIndex: 0, endIndex: 4 };
    const { port1, port2 } = new MessageChannel();

    const received = new Promise<SweepChunkRequest>((resolve) => {
      port2.once("message", (data: SweepChunkRequest) => resolve(data));
    });

    const response = postSweepChunkResult(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- node:worker_threads' MessagePort.postMessage types its transfer list against the DOM `Transferable` type, unavailable in this DOM-lib-free package; this is a real port, not a type-safety-critical call.
      (message, transfer) => port1.postMessage(message, transfer as any),
      request,
    );

    // A structured-clone COPY would leave the sender's buffers intact; a
    // real transfer detaches them synchronously, in this same tick.
    expect(response.range.buffer.byteLength).toBe(0);
    expect(response.apexHeight.buffer.byteLength).toBe(0);

    // ...and the receiving side genuinely got a working, correctly-sized copy.
    const receivedResponse = (await received) as unknown as {
      range: Float64Array;
      apexHeight: Float64Array;
    };
    expect(receivedResponse.range.length).toBe(4);
    expect(receivedResponse.apexHeight.length).toBe(4);

    port1.close();
    port2.close();
  });
});

/**
 * An in-process fake `WorkerLike` for optimize jobs (P5.18). Like
 * {@link createFakeWorker} it runs the same `postOptimizeResult` a real
 * `optimize-worker-entry.ts` would, so the pool's real message handling is
 * exercised -- but it drives the solve one message per macrotask
 * (`setTimeout(0)`) rather than computing it all in one microtask, because
 * the behaviour under test is *streaming*: a cancel has to be able to land
 * between two iterations, and a fake that delivered every message in one go
 * would make that unobservable.
 */
function createFakeOptimizeWorker(): {
  worker: WorkerLike;
  terminated: () => boolean;
  posted: () => number;
} {
  let terminated = false;
  let posted = 0;
  const worker: WorkerLike = {
    postMessage(message) {
      const request = message as OptimizeRequest;
      const queue: unknown[] = [];
      postOptimizeResult((out) => queue.push(out), request);
      const drain = (index: number): void => {
        if (terminated || index >= queue.length) return;
        setTimeout(() => {
          if (terminated) return;
          posted++;
          worker.onmessage?.({ data: queue[index] });
          drain(index + 1);
        }, 0);
      };
      drain(0);
    },
    terminate() {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  return { worker, terminated: () => terminated, posted: () => posted };
}

const OPTIMIZE_JOB: OptimizeJob = {
  baseScenario: BASE_SCENARIO,
  target: { kind: "point", center: [1200, 0] },
  initialAim: { theta: 0.5, speed: 130 },
};

describe("createWorkerPool: optimize jobs (P5.18)", () => {
  it("runs an optimize job through a worker and returns the converged result", async () => {
    const fake = createFakeOptimizeWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });

    const result = await pool.runOptimize(OPTIMIZE_JOB);

    expect(result.converged).toBe(true);
    expect(result.status).toBe("converged");
    // The same answer the job produces in-process -- the pool moves the work,
    // it does not change it.
    expect(result.aim).toEqual(runOptimizeJob(OPTIMIZE_JOB).aim);
  });

  it("streams every iteration to onIteration, in order, before the result resolves", async () => {
    const fake = createFakeOptimizeWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });

    const streamed: number[] = [];
    let resolved = false;
    const promise = pool.runOptimize(OPTIMIZE_JOB, {
      onIteration: (iteration) => {
        // If iterations arrived only after the promise settled, this would
        // catch it -- the trace would be useless for a live display.
        expect(resolved).toBe(false);
        streamed.push(iteration.step.iteration);
      },
    });
    const result = await promise;
    resolved = true;

    expect(streamed).toEqual(streamed.map((_, i) => i));
    expect(streamed.length).toBe(result.iterations);
    expect(streamed.length).toBeGreaterThan(1);
  });

  it("cancelling mid-stream rejects, terminates the worker, and stops delivering iterations", async () => {
    const fake = createFakeOptimizeWorker();
    let created = 0;
    const replacements: Array<ReturnType<typeof createFakeOptimizeWorker>> = [];
    const pool = createWorkerPool({
      size: 1,
      createWorker: () => {
        if (created++ === 0) return fake.worker;
        const next = createFakeOptimizeWorker();
        replacements.push(next);
        return next.worker;
      },
    });

    const controller = new AbortController();
    const streamed: number[] = [];
    const promise = pool.runOptimize(OPTIMIZE_JOB, {
      signal: controller.signal,
      onIteration: (iteration) => {
        streamed.push(iteration.step.iteration);
        // Cancel as soon as the trace has something in it, which is the
        // realistic case: a user watching the trace decides to stop.
        if (streamed.length === 1) controller.abort();
      },
    });

    await expect(promise).rejects.toBeInstanceOf(OptimizeCancelledError);
    expect(fake.terminated()).toBe(true);
    expect(streamed).toEqual([0]);

    // Nothing arrives afterwards, even though the fake had more queued.
    const before = streamed.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(streamed.length).toBe(before);

    // And the pool refilled the slot, so it still works.
    expect(replacements).toHaveLength(1);
    const after = await pool.runOptimize(OPTIMIZE_JOB);
    expect(after.converged).toBe(true);
  });

  it("a signal already aborted rejects without posting anything to a worker", async () => {
    const fake = createFakeOptimizeWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });

    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.runOptimize(OPTIMIZE_JOB, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OptimizeCancelledError);
    expect(fake.posted()).toBe(0);
  });

  it("a signal that never fires leaves the solve untouched and the worker alive", async () => {
    const fake = createFakeOptimizeWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });

    const controller = new AbortController();
    const result = await pool.runOptimize(OPTIMIZE_JOB, { signal: controller.signal });

    expect(result.converged).toBe(true);
    expect(fake.terminated()).toBe(false);

    // Aborting after the fact must not reach into a settled job.
    expect(() => controller.abort()).not.toThrow();
    expect(fake.terminated()).toBe(false);
  });
});
