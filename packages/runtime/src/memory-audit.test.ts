import { describe, expect, it } from "vitest";

import {
  MEMORY_AUDIT_CHUNK_SIZE,
  MEMORY_AUDIT_PEAK_BUDGET_BYTES,
  MEMORY_AUDIT_REPLICATES,
  MEMORY_AUDIT_STEP_SIZE,
  auditChunks,
  chunkColumns,
  meetsMajorGcBudget,
  meetsPeakBudget,
  memoryAuditStudy,
  memoryAuditVerdict,
  peakSampledHeapUsed,
  peakSampledRss,
  runMemoryAuditWorkload,
  type MemoryAuditReading,
  type MemorySample,
} from "./memory-audit.js";
import { createMcColumns, runMcRange, type McJob } from "./mc-job.js";

// P7.06. The same division batch-throughput.test.ts draws, for the same
// reason:
//
//   THIS FILE CAN assert the audit's *definition* -- that the workload is
//   the real study rather than a stand-in, that chunking cannot change a
//   result, that the destination is one allocation however it is cut, and
//   that the verdict rule reads what it claims to read.
//
//   IT CANNOT assert the measurement. A memory reading depends on the heap
//   the test runner is already holding, on other test files running in the
//   same pool, and on when V8 feels like collecting. A test asserting
//   "peak < 300 MB" inside vitest would be measuring vitest, and would be a
//   flake generator besides. scripts/measure-ensemble-memory.mjs takes the
//   reading in a process of its own; the numbers live in its artifact and in
//   ROADMAP.json, never here.
//
// So every number below is either a shape or a synthetic reading fed to the
// verdict functions.

describe("the audit's workload is the study the criterion names", () => {
  it("runs the throughput benchmark's scenario, not a stand-in", () => {
    const study = memoryAuditStudy(64);
    expect(study.replicates).toBe(64);
    expect(study.base.solver.h).toBe(MEMORY_AUDIT_STEP_SIZE);
    expect(study.base.solver.stepper).toBe("classical-rk4");
    // Uncertainty is what makes it a study rather than one trajectory run
    // 1e5 times; without overlays the audit would measure a workload no
    // dashboard produces.
    expect(study.overlays.length).toBeGreaterThan(0);
  });

  it("names 1e5 replicates and a 300 MiB budget, both as the criterion states them", () => {
    expect(MEMORY_AUDIT_REPLICATES).toBe(100_000);
    expect(MEMORY_AUDIT_PEAK_BUDGET_BYTES).toBe(300 * 1024 * 1024);
  });

  it("is not adaptive — an adaptive field here would change the workload silently", () => {
    const study = memoryAuditStudy(8);
    expect(study.base.solver.rtol).toBeUndefined();
    expect(study.base.solver.atol).toBeUndefined();
    expect(study.base.solver.controller).toBeUndefined();
  });
});

describe("chunking", () => {
  it("covers [0, replicates) exactly once, in order", () => {
    const chunks = auditChunks(10_000, MEMORY_AUDIT_CHUNK_SIZE);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(10_000);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.start).toBe(chunks[i - 1]?.end);
    }
  });

  it("leaves the last chunk short rather than spreading the remainder", () => {
    const chunks = auditChunks(2500, 1000);
    expect(chunks.map((c) => c.end - c.start)).toEqual([1000, 1000, 500]);
  });

  it("returns no chunks for an empty study", () => {
    expect(auditChunks(0, 1000)).toEqual([]);
  });

  it("rejects a non-positive chunk size and a negative count", () => {
    expect(() => auditChunks(10, 0)).toThrow(RangeError);
    expect(() => auditChunks(-1, 10)).toThrow(RangeError);
    expect(() => auditChunks(10, 1.5)).toThrow(RangeError);
  });
});

describe("chunkColumns hands out views, not copies", () => {
  it("shares the whole-study buffer, so a chunked write lands at the study index", () => {
    const columns = createMcColumns(10);
    const view = chunkColumns(columns, 4, 7);
    expect(view.range.length).toBe(3);
    view.range[0] = 12.5;
    view.landed[2] = 1;
    // Chunk-local 0 is study index 4; chunk-local 2 is study index 6.
    expect(columns.range[4]).toBe(12.5);
    expect(columns.landed[6]).toBe(1);
    // And nothing outside the chunk moved.
    expect(columns.range[3]).toBe(0);
    expect(columns.range[7]).toBe(0);
  });

  it("shares the same ArrayBuffer — this is the property that keeps the result one allocation", () => {
    const columns = createMcColumns(10);
    const view = chunkColumns(columns, 2, 5);
    expect(view.range.buffer).toBe(columns.range.buffer);
    expect(view.landed.buffer).toBe(columns.landed.buffer);
  });

  it("rejects a range outside the study", () => {
    const columns = createMcColumns(10);
    expect(() => chunkColumns(columns, -1, 5)).toThrow(RangeError);
    expect(() => chunkColumns(columns, 0, 11)).toThrow(RangeError);
    expect(() => chunkColumns(columns, 6, 5)).toThrow(RangeError);
    expect(() => chunkColumns(columns, 0, 2.5)).toThrow(RangeError);
  });
});

describe("chunking cannot change a result", () => {
  // The property the whole audit rests on: if cutting the study into chunks
  // moved a number, every reading taken mid-run would describe a different
  // study from the one the criterion names. Asserted bit-for-bit rather than
  // with a tolerance -- a replicate is a pure function of (seed, index), so
  // there is no floating-point argument for any difference at all.
  const REPLICATES = 24;

  it("is bit-identical to one unchunked runMcRange over the same study", () => {
    const job: McJob = { study: memoryAuditStudy(REPLICATES) };
    const reference = createMcColumns(REPLICATES);
    runMcRange(job, 0, REPLICATES, reference);

    const chunked = runMemoryAuditWorkload({ replicates: REPLICATES, chunkSize: 5 });

    for (let i = 0; i < REPLICATES; i++) {
      expect(Object.is(chunked.range[i], reference.range[i])).toBe(true);
      expect(Object.is(chunked.apexHeight[i], reference.apexHeight[i])).toBe(true);
      expect(Object.is(chunked.timeOfFlight[i], reference.timeOfFlight[i])).toBe(true);
      expect(Object.is(chunked.impactSpeed[i], reference.impactSpeed[i])).toBe(true);
      expect(chunked.landed[i]).toBe(reference.landed[i]);
    }
  });

  it("gives the same answers at two different chunk sizes", () => {
    const a = runMemoryAuditWorkload({ replicates: REPLICATES, chunkSize: 5 });
    const b = runMemoryAuditWorkload({ replicates: REPLICATES, chunkSize: 24 });
    expect(Array.from(a.range)).toEqual(Array.from(b.range));
    expect(Array.from(a.landed)).toEqual(Array.from(b.landed));
  });

  it("reports every chunk boundary to onChunk, ending at the replicate count", () => {
    const seen: number[] = [];
    runMemoryAuditWorkload({
      replicates: REPLICATES,
      chunkSize: 10,
      onChunk: (completed) => seen.push(completed),
    });
    expect(seen).toEqual([10, 20, 24]);
  });

  it("actually runs the study — the columns are not left at their zero fill", () => {
    const columns = runMemoryAuditWorkload({ replicates: 4, chunkSize: 2 });
    expect(Array.from(columns.range).every((r) => r > 0)).toBe(true);
  });
});

describe("the verdict reads both halves of the criterion", () => {
  const reading = (over: Partial<MemoryAuditReading>): MemoryAuditReading => ({
    replicates: MEMORY_AUDIT_REPLICATES,
    chunkSize: MEMORY_AUDIT_CHUNK_SIZE,
    maxRssBytes: 100 * 1024 * 1024,
    majorCollections: 0,
    minorCollections: 42,
    samples: [],
    ...over,
  });

  it("passes only when both halves pass", () => {
    expect(memoryAuditVerdict(reading({}))).toEqual({
      peakOk: true,
      majorGcOk: true,
      pass: true,
    });
    expect(memoryAuditVerdict(reading({ majorCollections: 1 }))).toEqual({
      peakOk: true,
      majorGcOk: false,
      pass: false,
    });
    expect(memoryAuditVerdict(reading({ maxRssBytes: 400 * 1024 * 1024 }))).toEqual({
      peakOk: false,
      majorGcOk: true,
      pass: false,
    });
  });

  it("reads the budget strictly — exactly 300 MiB is not 'under 300 MB'", () => {
    expect(meetsPeakBudget(reading({ maxRssBytes: MEMORY_AUDIT_PEAK_BUDGET_BYTES }))).toBe(false);
    expect(meetsPeakBudget(reading({ maxRssBytes: MEMORY_AUDIT_PEAK_BUDGET_BYTES - 1 }))).toBe(
      true,
    );
  });

  it("budgets major collections only — minor ones are recorded and do not fail a run", () => {
    expect(meetsMajorGcBudget(reading({ minorCollections: 10_000 }))).toBe(true);
    expect(meetsMajorGcBudget(reading({ majorCollections: 1, minorCollections: 0 }))).toBe(false);
  });
});

describe("sample reduction", () => {
  const samples: MemorySample[] = [
    { completed: 5000, rss: 90, heapUsed: 40 },
    { completed: 10_000, rss: 120, heapUsed: 30 },
    { completed: 15_000, rss: 110, heapUsed: 55 },
  ];

  it("takes the maximum of each series independently", () => {
    // Deliberately a case where the two peaks are at different samples: rss
    // peaks mid-run while heapUsed peaks at the end, which is the ordinary
    // shape when V8 holds pages it is no longer using.
    expect(peakSampledRss(samples)).toBe(120);
    expect(peakSampledHeapUsed(samples)).toBe(55);
  });

  it("returns 0 for no samples rather than -Infinity", () => {
    expect(peakSampledRss([])).toBe(0);
    expect(peakSampledHeapUsed([])).toBe(0);
  });
});
