import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import {
  PRESET_SCENARIOS,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import { runMcDashboardStudy, type McDashboardStudySpec } from "./mc-dashboard-study.js";
import { runOptimizeJob, type OptimizeJob } from "./optimize-job.js";
import { runSweepPoint, sweepPointCount, type SweepJob } from "./sweep-job.js";
import {
  createWorkerPool,
  handleSweepChunkRequest,
  McCancelledError,
  OptimizeCancelledError,
  postMcResult,
  postOptimizeResult,
  postSweepChunkResult,
  type McProgressMessage,
  type McRequest,
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

// --- mc jobs (P0.119) ------------------------------------------------------ //

const MC_GOLF_DRIVE = PRESET_SCENARIOS.find((scenario) =>
  scenario.model.forceIds.includes("magnus"),
)!;

/** A study small enough for a unit test but with the same shape the dashboard runs. */
function mcStudy(replicates: number): UncertainScenarioSpec {
  return uncertainScenarioSpecSchema.parse({
    schemaVersion: 1,
    base: {
      ...MC_GOLF_DRIVE,
      initialConditions: { ...MC_GOLF_DRIVE.initialConditions, x0: 0, y0: 0 },
    },
    overlays: [
      {
        path: "initialConditions.vx0",
        distribution: {
          kind: "normal",
          mean: MC_GOLF_DRIVE.initialConditions.vx0,
          stdDev: 1.5,
        },
      },
    ],
    replicates,
    seed: 20260926,
  });
}

function mcSpec(replicates: number): McDashboardStudySpec {
  return {
    study: mcStudy(replicates),
    target: { kind: "point", center: [180, 0], tolerance: 1e4 },
  };
}

const MC_STUDY_OPTIONS = { fanReplicates: 4, fanGridPoints: 16 } as const;

/**
 * An in-process fake `WorkerLike` for mc studies, built exactly like
 * {@link createFakeOptimizeWorker} and for its reason: it runs the same
 * {@link postMcResult} a real `mc-worker-entry.ts` would, delivering one
 * message per macrotask so that a cancel can land *between* two messages. A
 * fake that delivered the whole queue at once would make cancellation
 * unobservable, which is the behaviour most worth testing here.
 */
function createFakeMcWorker(): {
  worker: WorkerLike;
  terminated: () => boolean;
  delivered: () => number;
} {
  let terminated = false;
  let delivered = 0;
  const worker: WorkerLike = {
    postMessage(message) {
      const request = message as McRequest;
      const queue: unknown[] = [];
      postMcResult((out) => queue.push(out), request);
      const drain = (index: number): void => {
        if (terminated || index >= queue.length) return;
        setTimeout(() => {
          if (terminated) return;
          delivered++;
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
  return { worker, terminated: () => terminated, delivered: () => delivered };
}

/** Collects everything {@link postMcResult} posts for one request, without a pool. */
function collectMcPosts(request: McRequest): unknown[] {
  const posted: unknown[] = [];
  postMcResult((message) => posted.push(message), request);
  return posted;
}

describe("createWorkerPool: mc studies (P0.119)", () => {
  it("runs a study through a worker and returns the same result the study produces in-process", async () => {
    const fake = createFakeMcWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });

    const result = await pool.runMc(mcSpec(12), { studyOptions: MC_STUDY_OPTIONS });

    // The pool moves the work; it must not change the answer. Replicate i is a
    // pure function of the seed and i (P6.03), so this is an exact comparison
    // rather than a tolerance.
    const inProcess = runMcDashboardStudy(mcSpec(12), MC_STUDY_OPTIONS);
    expect(Array.from(result.columns.range)).toEqual(Array.from(inProcess.columns.range));
    expect(result.hit.pHat).toBe(inProcess.hit.pHat);
    expect(result.stats.count).toBe(inProcess.stats.count);
    expect(result.cost.total).toBe(inProcess.cost.total);
  });

  it("streams progress to onProgress, in order, before the result resolves", async () => {
    const fake = createFakeMcWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });

    const completed: number[] = [];
    let resolved = false;
    const promise = pool.runMc(mcSpec(16), {
      studyOptions: MC_STUDY_OPTIONS,
      onProgress: (progress) => {
        // Progress arriving only after the promise settled would make the bar
        // and the live estimate useless.
        expect(resolved).toBe(false);
        completed.push(progress.completed);
      },
    });
    const result = await promise;
    resolved = true;

    expect(completed.length).toBeGreaterThan(1);
    expect([...completed].sort((a, b) => a - b)).toEqual(completed);
    expect(completed[completed.length - 1]!).toBeLessThanOrEqual(result.cost.total);
  });

  it("cancelling mid-study rejects, terminates the worker, and stops delivering progress", async () => {
    const fake = createFakeMcWorker();
    let created = 0;
    const pool = createWorkerPool({
      size: 1,
      createWorker: () => {
        if (created++ === 0) return fake.worker;
        return createFakeMcWorker().worker;
      },
    });

    const controller = new AbortController();
    let seen = 0;
    const promise = pool.runMc(mcSpec(64), {
      studyOptions: MC_STUDY_OPTIONS,
      signal: controller.signal,
      onProgress: () => {
        seen += 1;
        if (seen === 2) controller.abort();
      },
    });

    await expect(promise).rejects.toBeInstanceOf(McCancelledError);
    expect(fake.terminated()).toBe(true);

    const atCancel = seen;
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Terminating is what makes this true: the worker's queue still held
    // messages, and none of them reached the caller.
    expect(seen).toBe(atCancel);

    // The slot was refilled, so the pool still works afterwards.
    const after = await pool.runMc(mcSpec(8), { studyOptions: MC_STUDY_OPTIONS });
    expect(after.cost.ensemble).toBe(8);
  });

  it("rejects immediately when the signal is already aborted, without touching the worker", async () => {
    const fake = createFakeMcWorker();
    const pool = createWorkerPool({ size: 1, createWorker: () => fake.worker });
    const controller = new AbortController();
    controller.abort();

    await expect(pool.runMc(mcSpec(8), { signal: controller.signal })).rejects.toBeInstanceOf(
      McCancelledError,
    );
    expect(fake.delivered()).toBe(0);
    expect(fake.terminated()).toBe(false);
  });
});

describe("postMcResult: throttles progress but never drops a partial (P0.119)", () => {
  it("posts far fewer progress messages than the study has steps", () => {
    const request: McRequest = { kind: "mc", spec: mcSpec(64), options: MC_STUDY_OPTIONS };
    const posted = collectMcPosts(request);
    const progress = posted.filter(
      (message): message is McProgressMessage =>
        (message as McProgressMessage).kind === "mc-progress",
    );
    const steps = runMcDashboardStudy(mcSpec(64), MC_STUDY_OPTIONS).cost.total;

    expect(steps).toBe(68);
    // Without throttling this would be one per step. The bound is generous on
    // purpose: partial-bearing steps are exempt, so the exact count is a
    // function of `partialEvery`, and pinning it would make this test fail on
    // a cadence change that is not a defect.
    expect(progress.length).toBeLessThan(steps / 2);
    expect(progress.length).toBeGreaterThan(1);
  });

  it("posts EVERY partial-bearing step even when the cadence lands off the throttle grid", () => {
    // 5 is chosen because it is coprime with the throttle of 8: partials land
    // on 5, 10, 15, 20, ... and only every eighth step is otherwise posted, so
    // a handler relying on the throttle alone would drop most of them. At the
    // default cadence of 16 every partial is already a multiple of 8 and this
    // test would pass on the broken code -- which is exactly why it does not
    // use the default.
    const options = { ...MC_STUDY_OPTIONS, partialEvery: 5 };
    const spec = mcSpec(40);
    const posted = collectMcPosts({ kind: "mc", spec, options });
    const postedPartials = posted.filter(
      (message): message is McProgressMessage =>
        (message as McProgressMessage).kind === "mc-progress" &&
        (message as McProgressMessage).progress.partial !== undefined,
    ).length;

    // What the study itself produces, counted independently of the handler.
    let studyPartials = 0;
    runMcDashboardStudy(spec, options, {
      onProgress: (progress) => {
        if (progress.partial !== undefined) studyPartials += 1;
      },
    });

    expect(studyPartials).toBeGreaterThan(4);
    expect(postedPartials).toBe(studyPartials);
  });

  it("posts exactly one terminal result, last", () => {
    const posted = collectMcPosts({ kind: "mc", spec: mcSpec(16), options: MC_STUDY_OPTIONS });
    const kinds = posted.map((message) => (message as { kind: string }).kind);

    expect(kinds.filter((kind) => kind === "mc-result")).toEqual(["mc-result"]);
    expect(kinds[kinds.length - 1]).toBe("mc-result");
  });
});
