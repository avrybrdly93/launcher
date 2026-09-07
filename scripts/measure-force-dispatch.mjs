// P7.04: does the force-dispatch call site actually cost anything, and is the
// deopt log actually clean?
//
// WHY THIS IS A SCRIPT AND NOT A PARAGRAPH. P7.04's validation criterion is
// "deopt log clean; +% throughput recorded". Both halves are measurements, and
// the 86th run's P0.127 established the house rule the hard way: a decision
// about a performance criterion that rests on a number nobody can re-run is
// not a decision. So the claim for this task was committed *before* any of
// these numbers existed, saying that if the dispatch turns out not to be
// megamorphic and the deopt log turns out to be already clean, that is the
// result and the task closes with no code change. This script is what decides
// that, and anyone who doubts the answer can re-run it in one command.
//
// Usage:
//   pnpm bench:dispatch                 # everything below
//   node scripts/measure-force-dispatch.mjs --child   # internal; see §2
//
// ---------------------------------------------------------------------------
// §1. IS THE CALL SITE MEGAMORPHIC? MEASURED BEHAVIOURALLY, NOT READ FROM A LOG
// ---------------------------------------------------------------------------
//
// `composeForces` runs `for (const force of forces) force.accumulate(...)`.
// Six classes implement `ForceModel`, and V8's inline cache holds four maps
// before a site goes megamorphic and stops inlining. That is the mechanism
// P7.04's title names.
//
// The obvious way to check is to read V8's IC state with `--trace-ic`. THAT
// FLAG DOES NOT EXIST IN THIS NODE. `node --v8-options` on v22 lists
// `--trace-deopt` and `--trace-opt` and no `--trace-ic`: IC tracing is a
// debug-build facility, and a release V8 accepts the flag by doing nothing.
// Checked before this script was written, rather than discovered by trusting
// an empty log as evidence of a clean IC.
//
// So the property is measured behaviourally, which is better evidence anyway
// because it is denominated in the thing anyone actually cares about:
//
//   mono(n)  n instances of ONE class
//   poly(n)  n instances of n DISTINCT classes WITH IDENTICAL BODIES
//
// Same number of calls, same arithmetic, same allocation, same loop. The ONLY
// difference between the two arms is how many maps reach the call site. Any
// gap between them is dispatch cost and nothing else. If megamorphism is real
// and it matters here, `poly` falls off a cliff between n=4 and n=5 while
// `mono` stays flat; if the gap is noise, there is nothing at this call site
// for P7.04 to win and saying so is the finding.
//
// The bodies are deliberately trivial. A realistic force body would swamp the
// dispatch difference and understate it -- this arm is meant to be the most
// generous possible reading of the megamorphism hypothesis, so that a null
// result here is a strong null and not an artefact of burying the signal.
// §3 then measures the real forces, where the ratio of dispatch to arithmetic
// is whatever it actually is.
//
// EVERY ARM RUNS IN ITS OWN PROCESS, AND THAT IS NOT FASTIDIOUSNESS -- THE
// FIRST VERSION OF THIS SCRIPT DID NOT, AND ITS NUMBERS WERE WRONG. There is
// exactly ONE `force.accumulate(...)` call site in the program: the one inside
// `composeForces`. Running mono(1), poly(1), mono(2), poly(2), ... in a single
// process feeds all of their classes through that one site, so by the time the
// n=5 arm runs, the IC is already saturated by the classes of every earlier
// arm and BOTH arms are megamorphic. The in-process run duly reported
// poly/mono ~= 1.0 at n=5,6,8 -- a clean-looking null result produced entirely
// by the harness contaminating itself. A shared inline cache is global state,
// and a benchmark of IC behaviour that reuses one is measuring its own history.
// Each (arm, n) pair therefore gets a fresh V8 isolate.
//
// ---------------------------------------------------------------------------
// §2. IS THE DEOPT LOG CLEAN?
// ---------------------------------------------------------------------------
//
// The parent process re-executes this file with `--trace-deopt`, runs the real
// projectile rhs and the real batched ensemble kernel hot, and greps the child
// output for bailouts. Every deopt V8 reports is printed, classified and
// counted; none is filtered away on the grounds that it "looks like startup".
//
// Two things about reading that output honestly:
//
//   - `deopt-lazy` bailouts on a first-time-seen function are normal warm-up
//     and mean nothing. What would be a finding is a *repeated eager* deopt
//     inside the hot loop, i.e. a function that gets optimized, bails, and
//     bails again -- a deopt loop, which is the thing that actually costs
//     throughput.
//   - The bundle is built by esbuild, so the function names in the log are the
//     bundled ones. They still identify the source function; they are not
//     rewritten here into something prettier that would not match a re-run.
//
// ---------------------------------------------------------------------------
// §3. THROUGHPUT, WHICH IS THE "+%" HALF OF THE CRITERION
// ---------------------------------------------------------------------------
//
// rhs calls/sec and batched steps/sec on the real planar projectile, at force
// sets of increasing size, so the "+%" this task records has a before.
//
// STANDING CONSTRAINT, CARRIED FROM P0.127 AND REPEATED HERE BECAUSE THIS IS
// WHERE IT WOULD BE VIOLATED. P7.04's criterion names no throughput threshold
// and must not acquire one. P0.127 measured the free-rhs ceiling on the step at
// 1.67x-1.81x, so P7.04 and P7.05 *together* cannot return more than ~1.7x on
// the step no matter how well either goes. Record the number. Do not quote a
// speedup this script did not measure.
//
// SOFT: this script measures and prints. It gates nothing, writes nothing, and
// exits 0 whatever it finds -- the same posture as the repository's other four
// perf scripts. Absolute rates depend on the machine; the ratios are the point.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const ENTRY = `
export {
  createPlanarProjectileModel,
  createEvalContext,
  createSphericalProjectileParams,
  composeForces,
  createForceRegistry,
  ConstantCd,
  ConstantAtmosphere,
  Environment,
  GravityForce,
  LinearDragForce,
  QuadraticDragForce,
  BuoyancyForce,
  MagnusForce,
  UniformGravity,
  ZeroWind,
  G_STD,
} from "@ballista/engine";
export {
  createEnsembleLayout,
  createEnsembleBlock,
  createBatchedEnsembleBuffers,
  stepEnsembleBatched,
  stateIndex,
  RK4_TABLEAU,
} from "@ballista/solverkit";
`;

async function loadWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ballista-dispatch-"));
  const out = join(dir, "bundle.mjs");
  // `resolveDir` is `packages/validation` for the same reason
  // measure-ensemble-step-decomposition.mjs uses it: pnpm links workspace
  // packages under each consuming package's `node_modules`, so `@ballista/*`
  // resolves from inside a package that depends on them and nowhere else --
  // `scripts/` included. The bundle lands outside the repo.
  await build({
    stdin: {
      contents: ENTRY,
      resolveDir: join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "validation"),
      sourcefile: "entry.ts",
      loader: "ts",
    },
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "error",
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Median rate over `trials` timed repetitions, after a warm-up. */
function measure(run, opsPerCall, { warmup = 5, trials = 9 } = {}) {
  for (let i = 0; i < warmup; i++) run();
  const rates = [];
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    run();
    rates.push((opsPerCall / (performance.now() - t0)) * 1000);
  }
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

// --------------------------------------------------------------------------
// §1 fixtures. Identical bodies; the only variable is the number of maps.
// --------------------------------------------------------------------------

/** One class, reused. Call site sees exactly one map: monomorphic by construction. */
function monoRegistry(n) {
  class OnlyForce {
    constructor(i) {
      this.id = `f${i}`;
      this.k = 1 + i;
    }
    accumulate(t, y, ctx, out) {
      out[0] += this.k * y[2];
      out[1] += this.k * y[3];
    }
  }
  return Array.from({ length: n }, (_, i) => new OnlyForce(i));
}

/**
 * `n` distinct classes with byte-identical bodies. Same arithmetic as
 * `monoRegistry(n)`, same call count; the call site sees `n` maps. Built with
 * a fresh class per element rather than a shared base, because subclasses of
 * one base that do not add fields can share a map and would silently defeat
 * the whole control.
 */
function polyRegistry(n) {
  return Array.from({ length: n }, (_, i) => {
    const Cls = class {
      constructor(j) {
        this.id = `f${j}`;
        this.k = 1 + j;
      }
      accumulate(t, y, ctx, out) {
        out[0] += this.k * y[2];
        out[1] += this.k * y[3];
      }
    };
    // Distinct field sets would change the arithmetic; distinct *classes* are
    // the variable. Naming them differently is cosmetic and does not affect
    // map identity, which is what the IC keys on.
    Object.defineProperty(Cls, "name", { value: `Force${i}` });
    return new Cls(i);
  });
}

function dispatchArm(m, registry, iterations) {
  const y = new Float64Array([0, 10, 60, 45]);
  const out = new Float64Array(2);
  const ctx = {};
  return () => {
    for (let i = 0; i < iterations; i++) m.composeForces(registry, 0, y, ctx, out);
  };
}

// --------------------------------------------------------------------------
// §3 fixtures. The real model and the real forces.
// --------------------------------------------------------------------------

function realFixture(m, forceCount) {
  const environment = new m.Environment(
    new m.UniformGravity(m.G_STD),
    new m.ConstantAtmosphere(1.225),
    new m.ZeroWind(),
  );
  const params = m.createSphericalProjectileParams({
    mass: 5,
    radius: 0.05,
    dragCoefficient: new m.ConstantCd(0.47),
  });
  // Ordered by how a real planar scenario switches them on. Coriolis is
  // excluded: it is 3D-only and throws from a planar model by design.
  const all = [
    new m.GravityForce(),
    new m.QuadraticDragForce(),
    new m.BuoyancyForce(),
    new m.LinearDragForce(),
    new m.MagnusForce(),
  ];
  const forces = all.slice(0, forceCount);
  return {
    forces,
    model: m.createPlanarProjectileModel(forces),
    ctx: m.createEvalContext(environment, params),
  };
}

function rhsArm(fixture, iterations) {
  const y = new Float64Array([0, 10, 60, 45]);
  const out = new Float64Array(4);
  return () => {
    for (let i = 0; i < iterations; i++) fixture.model.rhs(0, y, out, fixture.ctx);
  };
}

function batchedArm(m, fixture, replicates, steps) {
  const layout = m.createEnsembleLayout(replicates, 0, 4);
  const block = m.createEnsembleBlock(layout);
  for (let r = 0; r < replicates; r++) {
    const seed = [0, 1 + 0.001 * r, 60 + 0.01 * r, 45 + 0.01 * r];
    for (let c = 0; c < 4; c++) block.data[m.stateIndex(layout, c, r)] = seed[c];
  }
  const buffers = m.createBatchedEnsembleBuffers(layout, m.RK4_TABLEAU.c.length);
  return () => {
    let t = 0;
    for (let s = 0; s < steps; s++) {
      m.stepEnsembleBatched(fixture.model, fixture.ctx, block, buffers, t, 1e-3, {
        tableau: m.RK4_TABLEAU,
      });
      t += 1e-3;
    }
  };
}

// --------------------------------------------------------------------------
// The child: runs everything hot so the parent's --trace-deopt sees real work.
// --------------------------------------------------------------------------

/**
 * One isolated measurement, in this process, printing a single JSON line the
 * parent parses. `--arm <kind> --n <count>`; `--deopt` additionally runs the
 * real model hot so the parent's `--trace-deopt` has something to report.
 *
 * A fresh process per arm is the whole point (see the header): the inline
 * cache at `composeForces`' call site is process-global, so an arm that shares
 * an isolate with another arm measures both.
 */
async function runChild(argv) {
  const arm = argv[argv.indexOf("--arm") + 1];
  const n = Number(argv[argv.indexOf("--n") + 1]);
  const { mod: m, cleanup } = await loadWorkspace();
  try {
    const iterations = 20000;
    let result;
    if (arm === "mono" || arm === "poly") {
      const registry = arm === "mono" ? monoRegistry(n) : polyRegistry(n);
      // Rate is per accumulate() call, so mono(n) and poly(n) are comparable
      // to each other and n is not silently in the denominator.
      result = { rate: measure(dispatchArm(m, registry, iterations), iterations * n) };
    } else if (arm === "real") {
      const fx = realFixture(m, n);
      const steps = 40;
      result = {
        rhs: measure(rhsArm(fx, 200000), 200000),
        batched: measure(batchedArm(m, fx, 256, steps), steps),
      };
    } else if (arm === "deopt") {
      // The real application shape, and only it: one model, one force set, one
      // call site. Deliberately NOT the mono/poly sweep, which would report
      // this harness's own map churn as if it were the engine's.
      const fx = realFixture(m, n);
      rhsArm(fx, 300000)();
      batchedArm(m, fx, 256, 60)();
      result = { ok: true };
    } else {
      throw new Error(`unknown arm ${arm}`);
    }
    console.log(`__RESULT__${JSON.stringify(result)}`);
  } finally {
    cleanup();
  }
}

/** Runs one arm in a fresh isolate and returns its parsed result plus raw output. */
function spawnArm(self, arm, n, extraFlags = []) {
  let text;
  let failed = false;
  try {
    text = execFileSync(
      process.execPath,
      [...extraFlags, self, "--child", "--arm", arm, "--n", String(n)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    failed = true;
  }
  const line = text.split("\n").find((l) => l.startsWith("__RESULT__"));
  return { result: line ? JSON.parse(line.slice("__RESULT__".length)) : null, text, failed };
}

function classifyDeopts(text) {
  const lines = text.split("\n").filter((l) => l.includes("[bailout"));
  const byReason = new Map();
  let eager = 0;
  let lazy = 0;
  for (const line of lines) {
    const kind = /kind: ([a-z-]+)/.exec(line)?.[1] ?? "unknown";
    const reason = /reason: ([^)]*)\)/.exec(line)?.[1] ?? "unknown";
    const fn = /<JSFunction ([^ ]*)/.exec(line)?.[1] ?? "(anonymous)";
    if (kind === "deopt-eager") eager++;
    else lazy++;
    const key = `${kind} | ${reason} | ${fn}`;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  return { total: lines.length, eager, lazy, byReason };
}

function runParent() {
  const self = fileURLToPath(import.meta.url);

  console.log("=".repeat(78));
  console.log("§2  DEOPT LOG — real model only, fresh isolate, --trace-deopt");
  console.log("=".repeat(78));
  for (const n of [2, 5]) {
    const { text, failed } = spawnArm(self, "deopt", n, ["--trace-deopt"]);
    if (failed) console.log(`  (child for ${n} forces exited non-zero; output still classified)`);
    const d = classifyDeopts(text);
    console.log(`\n  ${n} forces — bailouts: ${d.total}  (eager ${d.eager}, lazy ${d.lazy})`);
    if (d.total === 0) {
      console.log("  CLEAN — V8 reported no bailout of any kind during the hot loops.");
    } else {
      for (const [key, count] of [...d.byReason].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(count).padStart(4)} x  ${key}`);
      }
    }
  }
  console.log(
    "\n  Nothing above is filtered. A repeated EAGER bailout in a hot function is\n" +
      "  the finding; a lazy bailout on first sight of a function is warm-up.",
  );

  console.log();
  console.log("=".repeat(78));
  console.log("§1  DISPATCH COST: n instances of ONE class vs n DISTINCT classes");
  console.log("     identical bodies, identical call count — the gap IS dispatch");
  console.log("     EVERY CELL IS ITS OWN PROCESS (the IC is process-global)");
  console.log("=".repeat(78));
  console.log("   n     mono calls/s     poly calls/s     poly/mono");
  for (const n of [1, 2, 3, 4, 5, 6, 8]) {
    const mono = spawnArm(self, "mono", n).result?.rate;
    const poly = spawnArm(self, "poly", n).result?.rate;
    if (mono === undefined || poly === undefined) {
      console.log(`  ${String(n).padStart(2)}  (arm failed)`);
      continue;
    }
    console.log(
      `  ${String(n).padStart(2)}  ${mono.toExponential(3).padStart(14)}  ` +
        `${poly.toExponential(3).padStart(14)}  ${(poly / mono).toFixed(3).padStart(10)}`,
    );
  }
  console.log(
    "\n  A megamorphic cliff would show as poly/mono dropping sharply between\n" +
      "  n=4 and n=5 and staying down. A ratio already low at n=2 is polymorphic\n" +
      "  dispatch, which is a different (and cheaper) thing than megamorphic.",
  );

  console.log();
  console.log("=".repeat(78));
  console.log("§3  REAL MODEL: rhs and batched step, by force-set size");
  console.log("     one process per row, so no row's IC sees another's classes");
  console.log("=".repeat(78));
  console.log("  forces      rhs calls/s     batched steps/s");
  for (const n of [1, 2, 3, 4, 5]) {
    const r = spawnArm(self, "real", n).result;
    if (!r) {
      console.log(`  ${String(n).padStart(6)}  (arm failed)`);
      continue;
    }
    console.log(
      `  ${String(n).padStart(6)}  ${r.rhs.toExponential(3).padStart(15)}  ` +
        `${r.batched.toExponential(3).padStart(18)}`,
    );
  }
  console.log(
    "\n  Absolute rates are machine-specific. P0.127 measured the free-rhs\n" +
      "  ceiling on the STEP at 1.67x-1.81x: P7.04 and P7.05 together cannot\n" +
      "  exceed that there. Record what is measured; quote no other speedup.",
  );
}

if (process.argv.includes("--child")) {
  await runChild(process.argv);
} else {
  runParent();
}
