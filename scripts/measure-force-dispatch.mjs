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
  specializeForces,
  spinParameter,
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
    // (atmosphere, gravity, wind) -- this order matters and the two are not
    // interchangeable. They happen to write disjoint EnvSample fields, which
    // is why swapping them is silent rather than loud in untyped code.
    new m.ConstantAtmosphere(),
    new m.UniformGravity(m.G_STD),
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

// --------------------------------------------------------------------------
// P7.05 candidates. These live HERE, not in @ballista/engine, because they
// were measured and NOT adopted -- §5 is the record of why. Keeping them in
// the benchmark keeps the finding reproducible without leaving an unused
// composer in the hot path of a physics engine.
// --------------------------------------------------------------------------

/**
 * Candidate A, "masked": one closure for every force set, selecting each
 * inlined body with `if (mask & BIT)`. This is the general form -- it handles
 * all 32 subsets of the planar set from a single body. Bits ascend in
 * id-sorted order, which is what makes the accumulation order match
 * `composeForces` bit-for-bit.
 */
function makeMaskedFused(m, registry) {
  const BIT = {
    buoyancy: 1 << 0,
    "drag-linear": 1 << 1,
    "drag-quadratic": 1 << 2,
    gravity: 1 << 3,
    magnus: 1 << 4,
  };
  let mask = 0;
  for (const f of registry) mask |= BIT[f.id];
  return (_t, _y, ctx, o) => {
    const p = ctx.params;
    const e = ctx.env;
    const v = ctx.vRel;
    let fx = 0;
    let fy = 0;
    if ((mask & 1) !== 0) fy += e.rho * p.volume * e.g;
    if ((mask & 2) !== 0) {
      const b = 6 * Math.PI * e.eta * p.radius;
      fx += -b * v[0];
      fy += -b * v[1];
    }
    if ((mask & 4) !== 0) {
      const cd = p.dragCoefficient.cd(ctx.re, ctx.mach);
      const k = 0.5 * e.rho * cd * p.area * ctx.speedRel;
      fx += -k * v[0];
      fy += -k * v[1];
    }
    if ((mask & 8) !== 0) fy += -p.mass * e.g;
    if ((mask & 16) !== 0) {
      const omega = p.spin;
      const lm = p.liftCoefficient;
      if (omega && lm) {
        const k =
          0.5 *
          e.rho *
          lm.cl(m.spinParameter(omega, p.radius, ctx.speedRel)) *
          p.area *
          ctx.speedRel *
          Math.sign(omega);
        fx += -k * v[1];
        fy += k * v[0];
      }
    }
    o[0] = fx;
    o[1] = fy;
  };
}

/**
 * Candidate B, "flat": the SAME arithmetic with no mask and no branches at
 * all, hand-written per force count. This is not a shippable design -- it
 * needs one body per subset, which is what codegen would have to emit -- and
 * it is measured precisely because it is the CEILING. It is the fastest a
 * fused composer could possibly be, so if it does not clear the criterion,
 * nothing in this family does.
 *
 * Bodies follow realFixture's slice order after id-sorting.
 */
function makeFlatFused(m, n) {
  if (n === 5) {
    return (_t, _y, ctx, o) => {
      const p = ctx.params,
        e = ctx.env,
        v = ctx.vRel;
      let fx = 0,
        fy = 0;
      fy += e.rho * p.volume * e.g;
      const b = 6 * Math.PI * e.eta * p.radius;
      fx += -b * v[0];
      fy += -b * v[1];
      const cd = p.dragCoefficient.cd(ctx.re, ctx.mach);
      const k = 0.5 * e.rho * cd * p.area * ctx.speedRel;
      fx += -k * v[0];
      fy += -k * v[1];
      fy += -p.mass * e.g;
      const omega = p.spin,
        lm = p.liftCoefficient;
      if (omega && lm) {
        const k2 =
          0.5 *
          e.rho *
          lm.cl(m.spinParameter(omega, p.radius, ctx.speedRel)) *
          p.area *
          ctx.speedRel *
          Math.sign(omega);
        fx += -k2 * v[1];
        fy += k2 * v[0];
      }
      o[0] = fx;
      o[1] = fy;
    };
  }
  if (n === 4) {
    // buoyancy, drag-linear, drag-quadratic, gravity
    return (_t, _y, ctx, o) => {
      const p = ctx.params,
        e = ctx.env,
        v = ctx.vRel;
      let fx = 0,
        fy = 0;
      fy += e.rho * p.volume * e.g;
      const b = 6 * Math.PI * e.eta * p.radius;
      fx += -b * v[0];
      fy += -b * v[1];
      const cd = p.dragCoefficient.cd(ctx.re, ctx.mach);
      const k = 0.5 * e.rho * cd * p.area * ctx.speedRel;
      fx += -k * v[0];
      fy += -k * v[1];
      fy += -p.mass * e.g;
      o[0] = fx;
      o[1] = fy;
    };
  }
  if (n === 3) {
    // buoyancy, drag-quadratic, gravity
    return (_t, _y, ctx, o) => {
      const p = ctx.params,
        e = ctx.env,
        v = ctx.vRel;
      let fx = 0,
        fy = 0;
      fy += e.rho * p.volume * e.g;
      const cd = p.dragCoefficient.cd(ctx.re, ctx.mach);
      const k = 0.5 * e.rho * cd * p.area * ctx.speedRel;
      fx += -k * v[0];
      fy += -k * v[1];
      fy += -p.mass * e.g;
      o[0] = fx;
      o[1] = fy;
    };
  }
  if (n === 2) {
    // drag-quadratic, gravity
    return (_t, _y, ctx, o) => {
      const p = ctx.params,
        e = ctx.env,
        v = ctx.vRel;
      let fx = 0,
        fy = 0;
      const cd = p.dragCoefficient.cd(ctx.re, ctx.mach);
      const k = 0.5 * e.rho * cd * p.area * ctx.speedRel;
      fx += -k * v[0];
      fy += -k * v[1];
      fy += -p.mass * e.g;
      o[0] = fx;
      o[1] = fy;
    };
  }
  // gravity
  return (_t, _y, ctx, o) => {
    o[0] = 0;
    o[1] = -ctx.params.mass * ctx.env.g;
  };
}

/** Fills the derived ctx fields the model's rhs normally sets before composing. */
function primeContext(m, ctx, y) {
  ctx.environment.sample(0, y[0], y[1], ctx.env);
  ctx.vRel[0] = y[2] - ctx.env.wx;
  ctx.vRel[1] = y[3] - ctx.env.wy;
  ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
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
    } else if (
      arm === "compose-loop" ||
      arm === "compose-spec" ||
      arm === "compose-fused" ||
      arm === "compose-flat"
    ) {
      // The A/B for this task, and the only honest one: the SAME real
      // registry, the SAME states, one process each, run back-to-back in one
      // invocation. Comparing a number from today's run against one written
      // down in an earlier commit compares two machine loads as much as two
      // code paths.
      const fx = realFixture(m, n);
      const registry = m.createForceRegistry(fx.forces);
      const out = [0, 0];
      const iterations = 200000;
      const specialized = m.specializeForces(registry);
      // P7.05. `fuseForces` inlines the force bodies; `specializeForces` still
      // calls them from one monomorphic site each. This is the pair P7.05's
      // ">=1.5x RHS speedup" is judged on, and the baseline is deliberately
      // the POST-P7.04 specialized path: measuring fused against the old
      // megamorphic loop would re-bank P7.04's already-recorded 1.4x-4.7x as
      // this task's result.
      const fused = makeMaskedFused(m, registry);
      const flat = makeFlatFused(m, n);

      // THE OUTPUT MUST BE OBSERVED AND THE INPUT MUST VARY, or this measures
      // nothing. The first version of this arm called the composer on one
      // fixed state and never read `out`. It reported the specialized path at
      // 1.6e9 calls/s -- 0.6 ns/call, well under the cost of the arithmetic
      // inside -- and a "speedup" of 7x to 27x. V8 had inlined the closure,
      // seen that nothing observes the result, and deleted the loop. The
      // `composeForces` arm survived because it is bigger and loops over an
      // array, so the "speedup" was the optimizer's success at deleting one
      // benchmark and not the other. A ratio that large should be read as a
      // broken harness before it is read as a result.
      //
      // So: STATES rotates, and every call's output is folded into a checksum
      // that is returned. Neither the calls nor the stores can be eliminated.
      const states = [];
      for (let k = 0; k < 64; k++) {
        const y = new Float64Array([k * 1.5, 10 + k * 0.25, 60 - k * 0.5, 45 + k * 0.3]);
        const ctx = m.createEvalContext(fx.ctx.environment, fx.ctx.params);
        primeContext(m, ctx, y);
        states.push({ y, ctx });
      }
      let checksum = 0;
      const run =
        arm === "compose-flat"
          ? () => {
              for (let i = 0; i < iterations; i++) {
                const st = states[i & 63];
                flat(0, st.y, st.ctx, out);
                checksum += out[0] + out[1];
              }
            }
          : arm === "compose-fused"
            ? () => {
                for (let i = 0; i < iterations; i++) {
                  const st = states[i & 63];
                  fused(0, st.y, st.ctx, out);
                  checksum += out[0] + out[1];
                }
              }
            : arm === "compose-spec"
              ? () => {
                  for (let i = 0; i < iterations; i++) {
                    const st = states[i & 63];
                    specialized(0, st.y, st.ctx, out);
                    checksum += out[0] + out[1];
                  }
                }
              : () => {
                  for (let i = 0; i < iterations; i++) {
                    const st = states[i & 63];
                    m.composeForces(registry, 0, st.y, st.ctx, out);
                    checksum += out[0] + out[1];
                  }
                };
      result = { rate: measure(run, iterations), checksum };
    } else if (arm === "real") {
      const fx = realFixture(m, n);
      const steps = 40;
      result = {
        rhs: measure(rhsArm(fx, 200000), 200000),
        batched: measure(batchedArm(m, fx, 256, steps), steps),
      };
    } else if (arm === "deopt" || arm === "deopt10x") {
      // The real application shape, and only it: one model, one force set, one
      // call site. Deliberately NOT the mono/poly sweep, which would report
      // this harness's own map churn as if it were the engine's.
      //
      // Run at two workloads so the parent can tell a settling deopt from a
      // deopt LOOP. One-time bailouts while V8 learns the shapes are ordinary
      // and their count does not grow with the work; a function that
      // re-optimizes and re-bails costs throughput and its count scales. That
      // distinction is the whole content of "is the deopt log clean", and it
      // cannot be read off a single run.
      const scale = arm === "deopt10x" ? 10 : 1;
      const fx = realFixture(m, n);
      rhsArm(fx, 300000 * scale)();
      batchedArm(m, fx, 256, 60 * scale)();
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
  console.log("§2  DEOPT LOG — real model, fresh isolate, --trace-deopt");
  console.log("     run at 1x and 10x the work: a SETTLING deopt count is flat,");
  console.log("     a deopt LOOP scales with the work. That is the real question.");
  console.log("=".repeat(78));
  for (const n of [2, 5]) {
    const rows = [];
    for (const arm of ["deopt", "deopt10x"]) {
      const { text, failed } = spawnArm(self, arm, n, ["--trace-deopt"]);
      if (failed) console.log(`  (child ${arm}/${n} exited non-zero; output still classified)`);
      rows.push([arm === "deopt" ? "1x" : "10x", classifyDeopts(text)]);
    }
    console.log(`\n  ${n} forces:`);
    for (const [label, d] of rows) {
      console.log(
        `    ${label.padStart(3)} work — bailouts ${d.total} (eager ${d.eager}, lazy ${d.lazy})`,
      );
      for (const [key, count] of [...d.byReason].sort((a, b) => b[1] - a[1])) {
        console.log(`           ${String(count).padStart(3)} x  ${key}`);
      }
    }
    const [[, one], [, ten]] = rows;
    if (ten.total === 0 && one.total === 0) {
      console.log("    => CLEAN: no bailout at either workload.");
    } else if (ten.total <= one.total + 1) {
      console.log(
        `    => CLEAN in the sense that matters: 10x the work produced ${ten.total} bailouts\n` +
          `       against ${one.total}. Flat, so these are one-time shape-settling deopts and\n` +
          "       not a deopt loop. No hot function is re-optimizing and re-bailing.",
      );
    } else {
      console.log(
        `    => NOT CLEAN: bailouts grew ${one.total} -> ${ten.total} with the work.\n` +
          "       That is a deopt loop and it is a real throughput cost.",
      );
    }
  }
  console.log("\n  Nothing above is filtered out of the report.");

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

  console.log();
  console.log("=".repeat(78));
  console.log("§4  THE A/B: composeForces vs specializeForces, SAME registry,");
  console.log("     one process each, both in this run — the +% P7.04 records");
  console.log("=".repeat(78));
  console.log("  forces      loop calls/s      spec calls/s      spec/loop");
  for (const n of [1, 2, 3, 4, 5]) {
    const loop = spawnArm(self, "compose-loop", n).result;
    const spec = spawnArm(self, "compose-spec", n).result;
    if (!loop || !spec) {
      console.log(`  ${String(n).padStart(6)}  (arm failed)`);
      continue;
    }
    // The two arms fold every output into a checksum. Equal checksums mean the
    // two paths computed the same numbers over all 64 states, so the ratio
    // beside them is a comparison of two correct implementations and not of
    // one correct one against one the optimizer hollowed out.
    const agree = Object.is(loop.checksum, spec.checksum) ? "=" : "DIFFER";
    console.log(
      `  ${String(n).padStart(6)}  ${loop.rate.toExponential(3).padStart(15)}  ` +
        `${spec.rate.toExponential(3).padStart(15)}  ` +
        `${(spec.rate / loop.rate).toFixed(3).padStart(13)}   checksum ${agree}`,
    );
  }
  console.log(
    "\n  This is the row that answered P7.04's criterion. Everything above it\n" +
      "  is context for why the number at 5 forces differs from the others.",
  );

  console.log();
  console.log("=".repeat(78));
  console.log("\u00a75  P7.05's CRITERION: does FUSING the force bodies beat P7.04?");
  console.log("     spec   = specializeForces, one monomorphic call per force");
  console.log("     masked = fused bodies, `if (mask & BIT)` per force (general)");
  console.log("     flat   = fused bodies, NO branches (the CEILING; not shippable)");
  console.log("     Baseline is spec, i.e. POST-P7.04. One process per arm.");
  console.log("=".repeat(78));
  console.log(
    "  forces     spec calls/s   masked calls/s     flat calls/s   masked/spec   flat/spec",
  );
  for (const n of [1, 2, 3, 4, 5]) {
    const spec = spawnArm(self, "compose-spec", n).result;
    const masked = spawnArm(self, "compose-fused", n).result;
    const flat = spawnArm(self, "compose-flat", n).result;
    if (!spec || !masked || !flat) {
      console.log(`  ${String(n).padStart(6)}  (arm failed)`);
      continue;
    }
    // All three fold every output over all 64 states. A checksum that DIFFERS
    // invalidates the row: it would mean the arms are not computing the same
    // physics, and the ratio beside it would compare a correct path against a
    // wrong one -- or against one the optimizer hollowed out.
    const agree =
      Object.is(spec.checksum, masked.checksum) && Object.is(spec.checksum, flat.checksum)
        ? "="
        : "DIFFER";
    console.log(
      `  ${String(n).padStart(6)}  ${spec.rate.toExponential(3).padStart(14)}  ` +
        `${masked.rate.toExponential(3).padStart(14)}  ` +
        `${flat.rate.toExponential(3).padStart(15)}  ` +
        `${(masked.rate / spec.rate).toFixed(3).padStart(11)}  ` +
        `${(flat.rate / spec.rate).toFixed(3).padStart(10)}   checksum ${agree}`,
    );
  }
  console.log(
    "\n  HOW TO READ THIS. `flat` is the ceiling: no mask, no branches, one\n" +
      "  hand-written body per force count -- the best any codegen could emit.\n" +
      "  If flat/spec is below P7.05's 1.5x, the criterion is unreachable by\n" +
      "  any fused composer, not merely unmet by these two. masked/spec below\n" +
      "  1 is why the general form was NOT adopted: the mask is a captured\n" +
      "  variable rather than a compile-time constant, so V8 cannot fold the\n" +
      "  branches, and P7.04's straight-line body already wins.\n\n" +
      "  P0.129 is the decision this table feeds.",
  );
}

if (process.argv.includes("--child")) {
  await runChild(process.argv);
} else {
  runParent();
}
