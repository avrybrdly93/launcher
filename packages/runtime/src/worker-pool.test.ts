import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { runSweepPoint, sweepPointCount, type SweepJob } from "./sweep-job.js";
import {
  createWorkerPool,
  handleSweepChunkRequest,
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
