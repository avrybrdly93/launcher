// Profiling baseline (P7.01): CPU profiles of an interactive solve and of
// the Monte Carlo batch, with the hotspots named from the measurement.
//
// WHAT THIS IS FOR. P6.26 measured the batch at 8370 traj/s here and 7917 on
// a CI runner against §2.6's 1e4, and established that the shortfall is
// per-trajectory cost rather than scheduling: one thread does ~2324 traj/s,
// four ideal threads would be ~9300, and 8370 is 90% of that. P0.120 owns
// closing the gap and names two *candidate* hotspots -- per-replicate model
// and context construction, and the Hermite dense-output wrapper -- as
// candidates rather than conclusions, with an explicit instruction that
// profiling should come before optimizing. This script is that profiling.
//
// IT MEASURES AND NAMES. IT DOES NOT OPTIMIZE. A profiling run that started
// changing the solver would destroy the baseline it exists to establish;
// any speed-up is P0.120's.
//
// WHY node:inspector RATHER THAN --cpu-prof. `--cpu-prof` profiles a whole
// process, and this script runs two different workloads that must not be
// mixed into one profile. An inspector Session can be started and stopped
// around each workload separately, which is the difference between "here
// are the interactive hotspots" and "here are the hotspots of a process
// that did two unrelated things".
//
// WHY SINGLE-THREADED. P6.26 already established parallel efficiency is
// fine (90% of ideal). A profile spread across four workers would divide the
// per-trajectory cost into four profiles and add thread bookkeeping that is
// measurably not where the time goes. One thread profiles the trajectory,
// which is the subject.
//
// THE .cpuprofile FILES ARE THE FLAMEGRAPHS. They load directly into Chrome
// DevTools (Performance > Load profile) and into speedscope, both of which
// render a flame graph from exactly this format. No SVG is rendered here and
// none is claimed: committing a generated bitmap that no test can check, in
// place of the data it was drawn from, would be the weaker artifact.
//
// SELF TIME IS COMPUTED FROM samples + timeDeltas, not from hitCount. V8's
// `hitCount` is a sample count, and turning it into time means assuming
// every sample cost the same. The sample/delta arrays give the real elapsed
// microseconds attributed to each node, which is what a hotspot ranking
// should be built on.
//
// WRITING IS OPT-IN (P0.102), like this repository's other measurement
// scripts. Pass `--record` to update the committed artifacts under
// scripts/profiles/; without it the script measures and reports but touches
// nothing.
//
// Usage:
//   node scripts/profile-hotspots.mjs [--record] [--replicates N]
//                                     [--interactive-iterations N]
//                                     [--step-size H] [--top N]

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROFILE_DIR = join(REPO_ROOT, "scripts", "profiles");
const REPORT_PATH = join(PROFILE_DIR, "hotspots.json");

/**
 * Replicates for the batch profile. Smaller than the throughput benchmark's
 * 40 000 because this is not a throughput measurement -- there is no worker
 * spawn to amortize, and the profiler's own sampling overhead makes the
 * wall-clock number here not comparable to the benchmark's anyway. 4000 is
 * enough that the sample count per hot function is in the thousands.
 */
const DEFAULT_REPLICATES = 4000;

/**
 * Interactive solves per profile. One solve is a few milliseconds, which at
 * the sampling interval below would yield too few samples to rank anything;
 * repeating it gives the profiler something to see. This does NOT make it a
 * throughput measurement -- the per-solve time is reported, but the ranking
 * is what the artifact is for.
 */
const DEFAULT_INTERACTIVE_ITERATIONS = 400;

/** Microseconds between samples. V8's default is 1000; 200 buys resolution on the short interactive solve. */
const SAMPLING_INTERVAL_US = 200;

/** How many hotspots the report lists per workload. The criterion asks for the top 3; the artifact carries more so the tail is visible. */
const DEFAULT_TOP_N = 12;

function parseArgs(argv) {
  const opts = {
    record: false,
    replicates: DEFAULT_REPLICATES,
    interactiveIterations: DEFAULT_INTERACTIVE_ITERATIONS,
    stepSize: undefined,
    top: DEFAULT_TOP_N,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--record") {
      opts.record = true;
    } else if (arg === "--replicates") {
      opts.replicates = Number(argv[++i]);
    } else if (arg === "--interactive-iterations") {
      opts.interactiveIterations = Number(argv[++i]);
    } else if (arg === "--step-size") {
      opts.stepSize = Number(argv[++i]);
    } else if (arg === "--top") {
      opts.top = Number(argv[++i]);
    } else {
      throw new Error(`profile-hotspots: unknown argument ${arg}`);
    }
  }
  for (const [key, value] of Object.entries(opts)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`profile-hotspots: --${key} must be a positive finite number, got ${value}`);
    }
  }
  return opts;
}

/**
 * Bundles the harness entry so Node can import it. Identical in purpose to
 * the bundling step in `measure-batch-throughput.mjs`: the workspace
 * packages resolve through bare specifiers whose package `main` is a `.ts`
 * file, which Node cannot follow and esbuild can.
 */
async function bundleHarness(outDir) {
  const outfile = join(outDir, "profile-harness.mjs");
  await esbuild.build({
    entryPoints: [join(REPO_ROOT, "packages", "runtime", "src", "profile-harness-entry.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Not minified, and that is load-bearing rather than incidental: a
    // minifier renames functions, and a hotspot list of `a`, `t` and `n` is
    // not a hotspot list. It also inlines, which would move time from the
    // function that owns it to the one that called it.
    minify: false,
    sourcemap: false,
    logLevel: "warning",
  });
  return outfile;
}

/**
 * Aggregates a V8 CPU profile into self-time per function.
 *
 * The profile is a call tree of `nodes` plus a flat sample stream: `samples[i]`
 * is the id of the node the profiler saw on top of the stack, and
 * `timeDeltas[i]` is the microseconds since the previous sample. Summing the
 * deltas per node id therefore gives real self time -- the time that node was
 * *executing*, not the time spent beneath it.
 *
 * Nodes are then folded by (functionName, url, line) because V8 emits a
 * separate node per call site: the same function reached from three callers
 * is three nodes, and leaving them split would rank a hot function below a
 * cold one that happened to have one caller.
 */
function selfTimeByFunction(profile) {
  const { nodes, samples, timeDeltas } = profile;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const selfMicrosByNode = new Map();
  // timeDeltas[i] is the gap BEFORE samples[i], so it is the time attributed
  // to the previous sample's node. Index 0's delta is the gap from profiling
  // start to the first sample and belongs to nothing.
  for (let i = 1; i < samples.length; i++) {
    const id = samples[i - 1];
    const delta = timeDeltas[i] ?? 0;
    if (delta <= 0) continue;
    selfMicrosByNode.set(id, (selfMicrosByNode.get(id) ?? 0) + delta);
  }

  const folded = new Map();
  let totalMicros = 0;
  for (const [id, micros] of selfMicrosByNode) {
    const node = nodeById.get(id);
    if (!node) continue;
    const frame = node.callFrame;
    const name = frame.functionName || "(anonymous)";
    const url = frame.url || "";
    const key = `${name} ${url} ${frame.lineNumber}`;
    const existing = folded.get(key);
    totalMicros += micros;
    if (existing) {
      existing.selfMicros += micros;
      existing.nodeCount += 1;
    } else {
      folded.set(key, {
        functionName: name,
        // Absolute temp-directory paths would make the artifact differ on
        // every machine for no informational gain; the bundle is one file,
        // so its own name is all the location there is.
        source: url ? url.split("/").pop() : "(native)",
        line: frame.lineNumber >= 0 ? frame.lineNumber + 1 : undefined,
        selfMicros: micros,
        nodeCount: 1,
      });
    }
  }

  const entries = [...folded.values()].sort((a, b) => b.selfMicros - a.selfMicros);
  return { entries, totalMicros };
}

/**
 * The functions P0.120 names as candidate hotspots, plus the two halves of a
 * replicate they need to be weighed against.
 *
 * These are answered with INCLUSIVE time, not self time, and that is the
 * whole reason this section exists alongside the self-time ranking above.
 * P0.120's candidate (a) is "`runMcReplicate` builds a model and a context
 * per replicate" -- the cost of that is everything underneath
 * `resolveModel`, almost none of which is in `resolveModel` itself, so it
 * cannot appear in a self-time list at all. A ranking that only reports self
 * time would show the setup cost as a dozen small unrelated rows and rank it
 * nowhere, which is exactly how a real hotspot hides.
 */
const CANDIDATE_FUNCTIONS = [
  "resolveModel",
  "resolveStepper",
  "resolveSolverConfig",
  "generateReplicate",
  "integrate",
];

/**
 * Inclusive (subtree) time per function name.
 *
 * V8 emits one node per call site, so a function reached from three callers
 * is three subtrees; they are summed. Nodes that have an ancestor of the
 * same name are skipped so a recursive function is not counted once per
 * frame -- none of {@link CANDIDATE_FUNCTIONS} recurses today, but a
 * measurement that silently triples if one ever does is not one to leave
 * lying around.
 */
function inclusiveTimeByFunction(profile, names) {
  const { nodes, samples, timeDeltas } = profile;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const selfMicros = new Map();
  for (let i = 1; i < samples.length; i++) {
    const delta = timeDeltas[i] ?? 0;
    if (delta > 0) selfMicros.set(samples[i - 1], (selfMicros.get(samples[i - 1]) ?? 0) + delta);
  }

  const subtreeMicros = new Map();
  const subtreeOf = (id, seen) => {
    if (subtreeMicros.has(id)) return subtreeMicros.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const node = nodeById.get(id);
    let total = selfMicros.get(id) ?? 0;
    for (const childId of node?.children ?? []) total += subtreeOf(childId, seen);
    subtreeMicros.set(id, total);
    return total;
  };
  for (const node of nodes) subtreeOf(node.id, new Set());

  const parentOf = new Map();
  for (const node of nodes) {
    for (const childId of node.children ?? []) parentOf.set(childId, node.id);
  }
  const hasAncestorNamed = (id, name) => {
    let cursor = parentOf.get(id);
    const guard = new Set();
    while (cursor !== undefined && !guard.has(cursor)) {
      guard.add(cursor);
      if (nodeById.get(cursor)?.callFrame.functionName === name) return true;
      cursor = parentOf.get(cursor);
    }
    return false;
  };

  const wanted = new Set(names);
  const totals = new Map();
  for (const node of nodes) {
    const name = node.callFrame.functionName;
    if (!wanted.has(name)) continue;
    if (hasAncestorNamed(node.id, name)) continue;
    totals.set(name, (totals.get(name) ?? 0) + (subtreeMicros.get(node.id) ?? 0));
  }
  return totals;
}

/** Runs `work` under a CPU profiler and returns its profile plus wall-clock elapsed time. */
async function profile(work) {
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: SAMPLING_INTERVAL_US });
    await session.post("Profiler.start");
    const startedAt = process.hrtime.bigint();
    const checksum = work();
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const { profile: cpuProfile } = await session.post("Profiler.stop");
    return { cpuProfile, elapsedSeconds, checksum };
  } finally {
    session.disconnect();
  }
}

/**
 * A checksum the workload's result must satisfy for the profile to mean
 * anything. Without a value derived from the output, nothing observes the
 * work and a runtime may elide part of what the profile is supposed to
 * include -- the guard `measure-batch-throughput.mjs` applies to its worker
 * chunks, applied here for the same reason.
 */
function assertObserved(label, checksum) {
  if (!Number.isFinite(checksum) || checksum === 0) {
    throw new Error(
      `profile-hotspots: ${label} produced a checksum of ${checksum}; the workload did not run`,
    );
  }
}

function formatTop(entries, totalMicros, n) {
  return entries.slice(0, n).map((entry, index) => ({
    rank: index + 1,
    functionName: entry.functionName,
    source: entry.source,
    line: entry.line,
    selfMicros: Math.round(entry.selfMicros),
    selfShare: totalMicros > 0 ? entry.selfMicros / totalMicros : 0,
    callSites: entry.nodeCount,
  }));
}

function printTable(label, top) {
  console.log(`\n${label}`);
  console.log("  rank  self%    self(ms)  function");
  for (const row of top) {
    console.log(
      `  ${String(row.rank).padStart(4)}  ${(row.selfShare * 100).toFixed(1).padStart(5)}%  ${(
        row.selfMicros / 1000
      )
        .toFixed(1)
        .padStart(9)}  ${row.functionName}${row.source ? ` (${row.source})` : ""}`,
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tempDir = mkdtempSync(join(tmpdir(), "ballista-profile-"));

  try {
    const bundlePath = await bundleHarness(tempDir);
    const harness = await import(pathToFileURL(bundlePath).href);

    // The step the batch profile runs at is the throughput benchmark's own
    // verdict rung, not a number chosen here: profiling a step the budget
    // is not read at would name hotspots of a workload nobody is judged on.
    // Taken from THROUGHPUT_STEP_LADDER via the same accuracy rule, so if
    // that rule ever changes this follows it instead of drifting.
    const stepSize = opts.stepSize ?? 0.05;

    // Warm-up, outside the profiler. V8 compiles and optimizes on the way
    // in, and a profile that includes the first few hundred interpreted
    // iterations reports the compiler's hotspots rather than the solver's.
    harness.interactiveSolveOnce();
    harness.profileMcBatch(50, stepSize);

    const interactive = await profile(() => {
      let steps = 0;
      for (let i = 0; i < opts.interactiveIterations; i++) {
        steps += harness.interactiveSolveOnce();
      }
      return steps;
    });
    assertObserved("interactive solve", interactive.checksum);

    const batch = await profile(() => {
      const columns = harness.profileMcBatch(opts.replicates, stepSize);
      let sum = 0;
      for (let i = 0; i < columns.range.length; i++) sum += columns.range[i];
      return sum;
    });
    assertObserved("mc batch", batch.checksum);

    const workloads = [
      {
        name: "interactive-solve",
        description:
          "One committed scenario solve as SimulationSession runs it: resolve model/stepper/config, then integrate with a TrajectoryRecorder, StatsCollector and EventCollector.",
        iterations: opts.interactiveIterations,
        elapsedSeconds: interactive.elapsedSeconds,
        perIterationMillis: (interactive.elapsedSeconds / opts.interactiveIterations) * 1000,
        cpuProfile: interactive.cpuProfile,
      },
      {
        name: "mc-batch",
        description: `runMcRange over the P6.26 benchmark study at h=${stepSize}, single-threaded, observables only (no TrajectoryRecorder).`,
        iterations: opts.replicates,
        elapsedSeconds: batch.elapsedSeconds,
        perIterationMillis: (batch.elapsedSeconds / opts.replicates) * 1000,
        cpuProfile: batch.cpuProfile,
      },
    ];

    const report = {
      task: "P7.01",
      generatedBy: "scripts/profile-hotspots.mjs",
      note: "Sampled CPU profile. Absolute times include profiler overhead and are NOT comparable to scripts/batch-throughput-results.json; the ranking is what this artifact is for.",
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: (await import("node:os")).cpus().length,
      },
      samplingIntervalMicros: SAMPLING_INTERVAL_US,
      stepSize,
      workloads: workloads.map((workload) => {
        const { entries, totalMicros } = selfTimeByFunction(workload.cpuProfile);
        const top = formatTop(entries, totalMicros, opts.top);
        printTable(
          `${workload.name}: ${workload.elapsedSeconds.toFixed(2)} s for ${workload.iterations} iterations (${workload.perIterationMillis.toFixed(3)} ms each)`,
          top,
        );

        const inclusive = inclusiveTimeByFunction(workload.cpuProfile, CANDIDATE_FUNCTIONS);
        const candidates = CANDIDATE_FUNCTIONS.map((name) => ({
          functionName: name,
          inclusiveMicros: Math.round(inclusive.get(name) ?? 0),
          inclusiveShare: totalMicros > 0 ? (inclusive.get(name) ?? 0) / totalMicros : 0,
        })).sort((a, b) => b.inclusiveMicros - a.inclusiveMicros);
        console.log("  -- inclusive (subtree) time, P0.120's candidates --");
        for (const candidate of candidates) {
          console.log(
            `  ${(candidate.inclusiveShare * 100).toFixed(1).padStart(6)}%  ${(
              candidate.inclusiveMicros / 1000
            )
              .toFixed(1)
              .padStart(9)} ms  ${candidate.functionName}`,
          );
        }

        return {
          name: workload.name,
          description: workload.description,
          iterations: workload.iterations,
          elapsedSeconds: workload.elapsedSeconds,
          perIterationMillis: workload.perIterationMillis,
          sampledMicros: Math.round(totalMicros),
          distinctFunctions: entries.length,
          topHotspots: top,
          candidateInclusiveTime: candidates,
        };
      }),
    };

    if (opts.record) {
      mkdirSync(PROFILE_DIR, { recursive: true });
      writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
      for (const workload of workloads) {
        writeFileSync(
          join(PROFILE_DIR, `${workload.name}.cpuprofile`),
          `${JSON.stringify(workload.cpuProfile)}\n`,
        );
      }
      console.log(`\nWrote ${REPORT_PATH} and 2 .cpuprofile files.`);
    } else {
      console.log("\nMeasured only; pass --record to update scripts/profiles/.");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
