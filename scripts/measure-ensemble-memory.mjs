// Memory audit for the 1e5-replicate study (P7.06), against §7's budget:
// "peak < 300 MB; zero GC major collections mid-run".
//
// WHAT THIS SCRIPT OWNS. The instruments and the artifact, and nothing else.
// The workload, the chunking, the reading shape and the verdict rule live in
// packages/runtime/src/memory-audit.ts, where the suite asserts them without
// taking a measurement. Same split as measure-batch-throughput.mjs, for the
// same reason: a benchmark whose definition lives in its own script is a
// benchmark nothing can check.
//
// WHY A CHILD PROCESS, AND WHY THIS IS NOT OPTIONAL. Every number here is a
// property of the whole process. Run in the same process as esbuild, the
// bundler's own heap is in the reading; run under vitest it would be the
// runner's. So this script bundles the workload, then spawns a bare `node`
// on the bundle whose only job is the study. The parent parses one line of
// JSON from it. Anything the parent allocates is by construction outside the
// measurement.
//
// HOW MAJOR COLLECTIONS ARE COUNTED. From V8's own gc performance entries --
// PerformanceObserver over entryType "gc", kind === NODE_PERFORMANCE_GC_MAJOR
// -- and never inferred from the shape of an RSS curve. An RSS plateau is
// consistent with a major collection that returned nothing and with no
// collection at all, and the criterion distinguishes them.
//
// "MID-RUN" IS READ LITERALLY. Collections are counted between the first
// chunk boundary and the last, not over the process lifetime. Node collects
// during startup and again while the module graph is being linked, and
// counting those would fail the criterion for reasons that have nothing to
// do with the study. The observer is armed at the first onChunk callback and
// disarmed at the last; both ends are recorded in the artifact so the
// interval is visible rather than asserted.
//
// THREE PEAK NUMBERS, BECAUSE ONE IS NOT AN AUDIT. maxRSS from
// process.resourceUsage() is the kernel's high-water mark and cannot be
// missed between samples -- it is what the verdict reads. Sampled rss and
// heapUsed are recorded alongside it because they answer different questions
// (what the machine gave up; what V8 held live) and because their shapes are
// what a future run would need to tell a leak from a plateau.
//
// SOFT-WARN, like this repository's other perf checks: a missed budget
// prints `::warning::` and exits 0. The artifact is the deliverable; the
// exit code is not the evidence. `--strict` makes it exit 1 for a run that
// wants a gate.
//
// WRITING IS OPT-IN (P0.102). `--record` updates the committed artifact;
// without it the script measures and reports and touches nothing.
//
// Usage:
//   node scripts/measure-ensemble-memory.mjs [--record] [--strict]
//                                            [--replicates N] [--chunk N]

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";

const ARTIFACT_PATH = new URL("./ensemble-memory-results.json", import.meta.url);

/**
 * The directory the child's imports resolve from: the runtime package's own
 * source. `@ballista/runtime` is the package being measured and is linked
 * into no node_modules, so the child imports the definition module by
 * relative path; its own `@ballista/engine` imports then resolve through
 * packages/runtime/node_modules, exactly as they do for the worker entries
 * measure-batch-throughput.mjs bundles.
 */
function resolveDir() {
  return fileURLToPath(new URL("../packages/runtime/src/", import.meta.url));
}

function parseArgs(argv) {
  const args = { record: false, strict: false, replicates: undefined, chunk: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--record") args.record = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--replicates") args.replicates = Number(argv[++i]);
    else if (arg === "--chunk") args.chunk = Number(argv[++i]);
    else throw new Error(`measure-ensemble-memory: unknown argument "${arg}"`);
  }
  return args;
}

// The child's source. Written here rather than committed as a file because
// it is the instrument, not a module: it imports the definition, arms the
// observer at the first chunk boundary, and prints one line of JSON. Keeping
// it inline means the thing being measured cannot drift from the thing being
// described three lines above it.
const CHILD_SOURCE = `
import { PerformanceObserver, constants, performance } from "node:perf_hooks";
import {
  MEMORY_AUDIT_CHUNK_SIZE,
  MEMORY_AUDIT_PEAK_BUDGET_BYTES,
  MEMORY_AUDIT_REPLICATES,
  memoryAuditVerdict,
  peakSampledHeapUsed,
  peakSampledRss,
  runMemoryAuditWorkload,
} from "./memory-audit.ts";

const replicates = Number(process.env.AUDIT_REPLICATES) || MEMORY_AUDIT_REPLICATES;
const chunkSize = Number(process.env.AUDIT_CHUNK) || MEMORY_AUDIT_CHUNK_SIZE;

// COLLECT EVERY ENTRY WITH ITS TIMESTAMP; CLASSIFY AFTERWARDS. A flag
// flipped inside onChunk would count nothing: PerformanceObserver callbacks
// are delivered on the event loop, and runMemoryAuditWorkload is entirely
// synchronous, so not one callback can run while the study is in flight.
// Every gc entry for the run therefore arrives in one batch after the loop,
// and "mid-run" has to be decided from entry.startTime against the two
// boundary timestamps rather than from anything sampled live.
const entries = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    entries.push({
      startTime: entry.startTime,
      duration: entry.duration,
      kind: entry.detail?.kind ?? entry.kind,
    });
  }
});
observer.observe({ entryTypes: ["gc"] });

const samples = [];
let midRunFromMs = null;
let midRunToMs = null;
let countingFrom = null;
let countingTo = null;

const started = process.hrtime.bigint();
const columns = runMemoryAuditWorkload({
  replicates,
  chunkSize,
  onChunk: (completed) => {
    // "Mid-run" spans the first chunk boundary to the last. Node collects
    // during startup and again while the module graph is linked, and
    // counting those would fail the criterion for reasons that have nothing
    // to do with the study.
    const now = performance.now();
    if (midRunFromMs === null) {
      midRunFromMs = now;
      countingFrom = completed;
    }
    midRunToMs = now;
    countingTo = completed;
    const usage = process.memoryUsage();
    samples.push({ completed, rss: usage.rss, heapUsed: usage.heapUsed });
  },
});
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

// Read after the loop so the columns cannot be collected before the
// high-water mark is taken -- and touched, so nothing can decide the study's
// result is dead and elide the work that produced it.
let checksum = 0;
for (let i = 0; i < columns.range.length; i++) checksum += columns.range[i];

const resource = process.resourceUsage();

// Yield twice so the observer's queued batches are actually delivered before
// the count is taken. One turn is enough in practice; two costs nothing and
// removes the question.
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
observer.disconnect();

const midRun = entries.filter(
  (e) => midRunFromMs !== null && e.startTime >= midRunFromMs && e.startTime <= midRunToMs,
);
const countKind = (list, kind) => list.filter((e) => e.kind === kind).length;

// maxRSS is reported in kilobytes by Node on every platform it supports.
const reading = {
  replicates,
  chunkSize,
  maxRssBytes: resource.maxRSS * 1024,
  majorCollections: countKind(midRun, constants.NODE_PERFORMANCE_GC_MAJOR),
  minorCollections: countKind(midRun, constants.NODE_PERFORMANCE_GC_MINOR),
  samples,
};

// The verdict is computed HERE, by the rule the suite tests, rather than
// reimplemented in the parent -- a second copy of a pass/fail rule that
// nothing asserts is exactly how a criterion quietly drifts.
process.stdout.write(
  JSON.stringify({
    ...reading,
    elapsedMs,
    checksum,
    incrementalCollections: countKind(midRun, constants.NODE_PERFORMANCE_GC_INCREMENTAL),
    weakCallbackCollections: countKind(midRun, constants.NODE_PERFORMANCE_GC_WEAKCB),
    majorCollectionsWholeProcess: countKind(entries, constants.NODE_PERFORMANCE_GC_MAJOR),
    minorCollectionsWholeProcess: countKind(entries, constants.NODE_PERFORMANCE_GC_MINOR),
    gcEntriesTotal: entries.length,
    countingFrom,
    countingTo,
    midRunFromMs,
    midRunToMs,
    peakSampledRssBytes: peakSampledRss(samples),
    peakSampledHeapUsedBytes: peakSampledHeapUsed(samples),
    budgetBytes: MEMORY_AUDIT_PEAK_BUDGET_BYTES,
    verdict: memoryAuditVerdict(reading),
  }) + "\\n",
);
`;

function bundleChild(outDir) {
  const outfile = join(outDir, "audit-bundle.mjs");
  // Fed through `stdin` with `resolveDir` at the repo root rather than
  // written into the temp directory first: `@ballista/runtime` is a
  // workspace specifier, and esbuild resolves an entry point's imports from
  // the entry point's own directory, where there is no node_modules.
  esbuild.buildSync({
    stdin: {
      contents: CHILD_SOURCE,
      resolveDir: resolveDir(),
      sourcefile: "audit-entry.mjs",
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "warning",
  });
  return outfile;
}

function mib(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outDir = mkdtempSync(join(tmpdir(), "ballista-memory-audit-"));
  let reading;
  try {
    const bundle = bundleChild(outDir);
    const stdout = execFileSync(process.execPath, [bundle], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        ...(args.replicates ? { AUDIT_REPLICATES: String(args.replicates) } : {}),
        ...(args.chunk ? { AUDIT_CHUNK: String(args.chunk) } : {}),
      },
    });
    reading = JSON.parse(stdout.trim().split("\n").at(-1));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const { verdict, budgetBytes: budget } = reading;

  const peakRss = reading.peakSampledRssBytes;
  const peakHeap = reading.peakSampledHeapUsedBytes;

  const report = {
    task: "P7.06",
    criterion: "peak < 300 MB; zero GC major collections mid-run",
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: (await import("node:os")).cpus().length,
    },
    budgetBytes: budget,
    reading: {
      replicates: reading.replicates,
      chunkSize: reading.chunkSize,
      elapsedMs: reading.elapsedMs,
      maxRssBytes: reading.maxRssBytes,
      peakSampledRssBytes: peakRss,
      peakSampledHeapUsedBytes: peakHeap,
      majorCollections: reading.majorCollections,
      minorCollections: reading.minorCollections,
      incrementalCollections: reading.incrementalCollections,
      weakCallbackCollections: reading.weakCallbackCollections,
      countingFrom: reading.countingFrom,
      countingTo: reading.countingTo,
      checksum: reading.checksum,
    },
    samples: reading.samples,
    verdict,
  };

  console.log(`P7.06 memory audit — ${reading.replicates} replicates, chunk ${reading.chunkSize}`);
  console.log(`  node ${process.version} on ${process.platform}/${process.arch}`);
  console.log(`  elapsed                ${(reading.elapsedMs / 1000).toFixed(1)} s`);
  console.log(
    `  peak RSS (kernel)      ${mib(reading.maxRssBytes)} MiB   budget ${mib(budget)} MiB`,
  );
  console.log(`  peak RSS (sampled)     ${mib(peakRss)} MiB`);
  console.log(`  peak heapUsed          ${mib(peakHeap)} MiB`);
  console.log(
    `  GC mid-run             major ${reading.majorCollections}, minor ${reading.minorCollections}, incremental ${reading.incrementalCollections}`,
  );
  console.log(
    `  counted over           replicates ${reading.countingFrom} .. ${reading.countingTo}`,
  );
  console.log(
    `  verdict                peak ${verdict.peakOk ? "PASS" : "FAIL"}, major GC ${verdict.majorGcOk ? "PASS" : "FAIL"} => ${verdict.pass ? "PASS" : "FAIL"}`,
  );

  if (args.record) {
    writeFileSync(ARTIFACT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`  recorded to            ${ARTIFACT_PATH.pathname}`);
  }

  if (!verdict.pass) {
    console.log(
      `::warning::P7.06 memory audit did not meet its budget (peak ${mib(reading.maxRssBytes)} MiB, ${reading.majorCollections} major collections)`,
    );
    if (args.strict) process.exitCode = 1;
  }
}

await main();
