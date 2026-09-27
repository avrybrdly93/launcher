// P0.130: does `dragCoefficient.cd()` cost anything, and would specialising it
// buy anything?
//
// THE QUESTION, AND WHY IT IS NOT THE ONE P7.04 ANSWERED. `QuadraticDragForce`
// .accumulate calls `ctx.params.dragCoefficient.cd(ctx.re, ctx.mach)` through
// the `DragCoefficientModel` interface on every rhs evaluation. Three classes
// in the engine implement that interface (`ConstantCd`,
// `TabulatedReynoldsCd`, `TabulatedMachCd`), plus one more in a solverkit
// test. That is the same inline-cache question P7.04 asked about *force*
// dispatch, one level down and never measured -- and it is a different site,
// so P7.04's answer does not carry over. P0.129's conclusion (the TS path is
// finished as a throughput source) bounds how much a change here could return;
// it says nothing about whether this site is polymorphic at all, which is a
// property of the site.
//
// Usage:
//   pnpm bench:cd-dispatch                        # everything below
//   node scripts/measure-cd-dispatch.mjs --child  # internal; one arm
//
// ---------------------------------------------------------------------------
// §1. THE ARMS, AND WHY THERE ARE FIVE RATHER THAN TWO
// ---------------------------------------------------------------------------
//
// P0.130's criterion is "cd-specialized vs current, same registry, one process
// per arm, checksums equal". Two arms would answer it literally and would not
// be interpretable, for two reasons this script builds controls for.
//
//   virtual        the repo's own `QuadraticDragForce`, unmodified.
//   virtual-copy   a bench-local class with a byte-identical body.
//   bound          a bench-local class calling a captured `cd` function,
//                  bound once at construction. Shippable in principle.
//   inlined        a bench-local class with the Cd value folded into the body
//                  as a literal. The CEILING: no call at all, and correct
//                  ONLY for `ConstantCd`, so deliberately not shippable.
//   virtual-poly   `virtual`, after the other two Cd classes have been driven
//                  through the same call site in the same isolate.
//
// `virtual-copy` is the control that makes the rest readable. Every
// specialised arm is a hand-written body in this file rather than the repo's
// class, so a gap between `virtual` and a specialised arm could be the
// specialisation or could be "bench-local class in a script versus bundled
// class from the workspace". If `virtual` and `virtual-copy` agree, that
// second explanation is excluded. The 136th run's control for P0.128 carried a
// negative case for the same reason: a comparison with no way to come out
// differently is not evidence.
//
// `inlined` is the arm that decides the task. If deleting the call entirely
// returns ~1.0x, no shippable specialisation can do better, and the axis
// closes on a measured ceiling rather than on an argument -- the shape P7.04's
// `flat` arm used, where the best body any codegen could emit was measured
// precisely so that a null result would be a strong null.
//
// `virtual-poly` is the megamorphism question. A scenario builds one params
// object with one Cd model, so the site may see exactly one map for a whole
// run and there may be nothing to specialise. That is a hypothesis about
// practice, and the honest way to test it is to also measure the case where it
// is false.
//
// ---------------------------------------------------------------------------
// §2. ONE PROCESS PER ARM, WHICH IS A CORRECTNESS REQUIREMENT AND NOT CARE
// ---------------------------------------------------------------------------
//
// There is exactly ONE `dragCoefficient.cd(...)` call site inside
// `QuadraticDragForce.accumulate`. Running the arms in one isolate feeds every
// Cd class through that one site, so by the time a later arm runs the inline
// cache is already saturated and BOTH arms are megamorphic -- a clean-looking
// null result produced entirely by the harness contaminating itself.
// measure-force-dispatch.mjs records that this is not hypothetical: its first
// version did exactly this and its numbers were wrong. Each arm therefore gets
// a fresh V8 isolate, and `virtual-poly` saturates its own isolate on purpose.
//
// ---------------------------------------------------------------------------
// §3. THE RATE IS BIMODAL PER ISOLATE, WHICH IS WHY THIS COMPARES PEAKS
// ---------------------------------------------------------------------------
//
// §2 forces each arm into its own process, and that turns out to matter far
// more than isolation. MEASURED, not assumed. Inside one process the seven
// timed trials are tight -- 23.9 24.5 25.0 25.7 25.7 25.7 for `virtual` in one
// isolate, a 1.08x spread. Between processes the SAME arm on the SAME commit
// lands at either ~24 or ~38 x10^6 calls/s and then stays there for the whole
// process. Every arm shows both clusters. So a fresh isolate draws once from a
// bimodal distribution of compilation outcomes and the draw decides the number:
// this is a JIT lottery, not gradual machine noise, and it is not something a
// handful of repetitions averages away.
//
// Two earlier designs of this script were defeated by it and are recorded
// because the failure is instructive. Running each arm once reported `virtual`
// at 25.7, 39.9 and 27.3 on three consecutive runs of an unchanged tree, and
// the byte-identical control arm at 1.311x, 0.609x and 1.037x of it. Running
// five interleaved rounds and taking medians did not help -- drift cancels in a
// within-round ratio, but a per-isolate lottery is not drift, and the control
// still came out spanning [0.665 .. 1.502].
//
// So this script reports PEAK: the best per-round rate an arm achieves over
// many independent isolates. Peak is the rate when V8 reaches the good
// compilation outcome, which is the thing that differs between two code shapes;
// the low cluster is the same fallback for every arm and tells you only how
// often the lottery was lost. The fast-mode hit rate is printed beside it,
// because if one arm never reaches the fast cluster that is itself the finding.
// Every arm's full set of per-round rates is printed, so nothing rests on the
// classification.
//
// ---------------------------------------------------------------------------
// §4. THE CONTROL ARM DECIDES WHETHER ANY OF IT IS READABLE
// ---------------------------------------------------------------------------
//
// `virtual-copy` is a byte-identical copy of the body being measured, so its
// true ratio against `virtual` is 1.0 by construction. It is therefore this
// script's own resolution limit: whatever interval it comes out spanning is the
// interval within which this harness cannot distinguish anything. A specialised
// arm's ratio means something only if it lands OUTSIDE that band.
//
// It has already earned its place twice. First: the arms were originally
// defined in this file while the engine came from a bundled workspace build,
// and the control read 0.474x -- so "a hand-written class in a different script
// than the engine" was worth a 2x difference all by itself, and every
// specialised arm's number was measuring that instead of its specialisation.
// The arms moved into ENTRY, inside the bundle, for that reason. Second: the
// bench classes at first had no `energyPower`, which the repo's class has, so
// their object shape differed from the class they were standing in for; they
// now carry it.
//
// THE READING RULE, stated before the numbers so it is not invented after them.
// (1) The control's peak ratio is 1.0 by construction, so its distance from 1.0
// is this harness's bias; if that exceeds 10% nothing here supports a
// conclusion. (2) A specialised arm's peak ratio means something only if it is
// further from 1.0 than the control is. (3) An arm that never reaches the fast
// cluster while the others do is a finding regardless of its median.
//
// This script gates nothing. It is SOFT by design and must stay that way.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

// The arms' drag forces are defined HERE, inside the bundle entry, rather than
// in this file -- and that is a correction this script's own control forced.
// See §4.
const ENTRY = `
import {
  ConstantCd,
  QuadraticDragForce,
} from "@ballista/engine";
import type { EvalContext, ForceModel, MutVec2 } from "@ballista/engine";

/** The one Cd value every arm computes with. Must match CD_VALUE in the script. */
const CD_VALUE = 0.47;

/** Byte-identical copy of QuadraticDragForce's body. The control arm. */
class VirtualCopyDrag implements ForceModel {
  readonly id = "drag-quadratic";
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, out: MutVec2): void {
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    out[0] += -k * ctx.vRel[0];
    out[1] += -k * ctx.vRel[1];
  }
  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    return -k * (ctx.vRel[0] * y[2] + ctx.vRel[1] * y[3]);
  }
}

/** The shippable specialisation: the Cd model's evaluation captured once. */
class BoundCdDrag implements ForceModel {
  readonly id = "drag-quadratic";
  constructor(private readonly cdFn: (re: number, mach: number) => number) {}
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, out: MutVec2): void {
    const cd = this.cdFn(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    out[0] += -k * ctx.vRel[0];
    out[1] += -k * ctx.vRel[1];
  }
  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const cd = this.cdFn(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    return -k * (ctx.vRel[0] * y[2] + ctx.vRel[1] * y[3]);
  }
}

/** The ceiling: no call at all. Correct only for ConstantCd(CD_VALUE). */
class InlinedCdDrag implements ForceModel {
  readonly id = "drag-quadratic";
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, out: MutVec2): void {
    const cd = CD_VALUE;
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    out[0] += -k * ctx.vRel[0];
    out[1] += -k * ctx.vRel[1];
  }
  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const cd = CD_VALUE;
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    return -k * (ctx.vRel[0] * y[2] + ctx.vRel[1] * y[3]);
  }
}

/** Built inside the bundle so every arm's body shares the engine's script. */
export function createDragForArm(arm: string): ForceModel {
  const cdModel = new ConstantCd(CD_VALUE);
  switch (arm) {
    case "virtual":
    case "virtual-poly":
      return new QuadraticDragForce();
    case "virtual-copy":
      return new VirtualCopyDrag();
    case "bound":
      return new BoundCdDrag((re, mach) => cdModel.cd(re, mach));
    case "inlined":
      return new InlinedCdDrag();
    default:
      throw new Error(\`unknown arm \${arm}\`);
  }
}

export {
  createPlanarProjectileModel,
  createEvalContext,
  createSphericalProjectileParams,
  ConstantCd,
  TabulatedReynoldsCd,
  TabulatedMachCd,
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
`;

async function loadWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ballista-cd-"));
  const out = join(dir, "bundle.mjs");
  // `resolveDir` is `packages/validation` for measure-force-dispatch.mjs's
  // reason: pnpm links workspace packages under each consuming package's
  // node_modules, so `@ballista/*` resolves from inside a package that depends
  // on them and nowhere else -- `scripts/` included.
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

/** Rate per second over `trials` timed repetitions, after a warm-up. */
function measureSpread(run, opsPerCall, { warmup = 3, trials = 7 } = {}) {
  for (let i = 0; i < warmup; i++) run();
  const rates = [];
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    run();
    rates.push((opsPerCall / (performance.now() - t0)) * 1000);
  }
  rates.sort((a, b) => a - b);
  return {
    min: rates[0],
    median: rates[Math.floor(rates.length / 2)],
    max: rates[rates.length - 1],
    // Carried so `--child` on its own prints the whole within-process
    // distribution: that is how §3's bimodality was found, and anyone
    // re-checking it needs the raw trials rather than a summary.
    rates,
  };
}

// --------------------------------------------------------------------------
// Fixtures. The arms' drag classes live in ENTRY above, inside the bundle; the
// id is "drag-quadratic" in every arm so createForceRegistry's id sort (P1.17)
// puts the force in the same registry position in all of them -- "same
// registry" in P0.130's criterion is load-bearing, because force order decides
// floating-point accumulation order at the ULP level.
// --------------------------------------------------------------------------

/** Must match CD_VALUE inside ENTRY. */
const CD_VALUE = 0.47;

/**
 * The five-force planar set, in the order a real scenario switches them on.
 * Coriolis is excluded: it is 3D-only and throws from a planar model by design.
 */
function fixtureFor(m, arm) {
  const environment = new m.Environment(
    new m.ConstantAtmosphere(),
    new m.UniformGravity(m.G_STD),
    new m.ZeroWind(),
  );
  const params = m.createSphericalProjectileParams({
    mass: 5,
    radius: 0.05,
    dragCoefficient: new m.ConstantCd(CD_VALUE),
  });
  const forces = [
    new m.GravityForce(),
    m.createDragForArm(arm),
    new m.BuoyancyForce(),
    new m.LinearDragForce(),
    new m.MagnusForce(),
  ];
  return {
    model: m.createPlanarProjectileModel(forces),
    ctx: m.createEvalContext(environment, params),
  };
}

/**
 * Drives the repo's own `cd()` call site with the OTHER two Cd classes, so the
 * inline cache at that site has seen three maps before the arm is timed. This
 * is what `virtual-poly` measures and it has to happen through the real class,
 * not through a copy, or it saturates the wrong site.
 */
function saturateCdSite(m) {
  const environment = new m.Environment(
    new m.ConstantAtmosphere(),
    new m.UniformGravity(m.G_STD),
    new m.ZeroWind(),
  );
  const force = new m.QuadraticDragForce();
  const out = new Float64Array(2);
  const y = new Float64Array([0, 10, 60, 45]);
  for (const cdModel of [new m.TabulatedReynoldsCd(), new m.TabulatedMachCd()]) {
    const params = m.createSphericalProjectileParams({
      mass: 5,
      radius: 0.05,
      dragCoefficient: cdModel,
    });
    const ctx = m.createEvalContext(environment, params);
    ctx.environment.sample(0, y[0], y[1], ctx.env);
    ctx.vRel[0] = y[2] - ctx.env.wx;
    ctx.vRel[1] = y[3] - ctx.env.wy;
    ctx.speedRel = Math.hypot(ctx.vRel[0], ctx.vRel[1]);
    ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
    ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
    for (let i = 0; i < 200_000; i++) force.accumulate(0, y, ctx, out);
  }
}

const ITERATIONS = 4_000_000;

/**
 * Sums every rhs output component over a fixed sweep of states. The checksum is
 * the whole comparison's foundation: if two arms disagree here they are not
 * solving the same problem and their rates are not comparable. Exact equality,
 * not a tolerance -- every arm performs the same operations in the same order on
 * the same values, so any difference is a real difference in what was computed.
 */
function checksum(fixture) {
  const y = new Float64Array(4);
  const out = new Float64Array(4);
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    y[0] = i * 3;
    y[1] = 10 + i * 7;
    y[2] = 60 - i * 0.5;
    y[3] = 45 - i * 0.25;
    fixture.model.rhs(0, y, out, fixture.ctx);
    for (let c = 0; c < 4; c++) sum += out[c];
  }
  return sum;
}

function rhsArm(fixture) {
  const y = new Float64Array([0, 10, 60, 45]);
  const out = new Float64Array(4);
  return () => {
    for (let i = 0; i < ITERATIONS; i++) fixture.model.rhs(0, y, out, fixture.ctx);
  };
}

async function runChild(argv) {
  const arm = argv[argv.indexOf("--arm") + 1];
  const { mod: m, cleanup } = await loadWorkspace();
  try {
    if (arm === "virtual-poly") saturateCdSite(m);
    const fixture = fixtureFor(m, arm);
    const sum = checksum(fixture);
    const rate = measureSpread(rhsArm(fixture), ITERATIONS);
    console.log(`__RESULT__${JSON.stringify({ arm, checksum: sum, ...rate })}`);
  } finally {
    cleanup();
  }
}

function spawnArm(self, arm) {
  let text;
  let failed = false;
  try {
    text = execFileSync(process.execPath, [self, "--child", "--arm", arm], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    failed = true;
  }
  const line = text.split("\n").find((l) => l.startsWith("__RESULT__"));
  return { result: line ? JSON.parse(line.slice("__RESULT__".length)) : null, text, failed };
}

const ARMS = ["virtual", "virtual-copy", "bound", "inlined", "virtual-poly"];
const ROUNDS = Number(process.env.CD_DISPATCH_ROUNDS ?? 12);
const NOISE_LIMIT = 1.5;

function fmt(x) {
  return (x / 1e6).toFixed(2);
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

function runParent() {
  const self = fileURLToPath(import.meta.url);
  /** rounds[i][arm] = that arm's result in round i. */
  const rounds = [];
  for (let round = 0; round < ROUNDS; round++) {
    const byArm = {};
    for (const arm of ARMS) {
      const { result, text, failed } = spawnArm(self, arm);
      if (failed || !result) {
        console.error(text);
        throw new Error(`arm ${arm} produced no result in round ${round + 1}`);
      }
      byArm[arm] = result;
    }
    rounds.push(byArm);
  }

  console.log("P0.130 -- Cd dispatch, planar rhs, five-force registry, one process per arm");
  console.log(
    `  ${ITERATIONS.toLocaleString("en-US")} rhs calls per timed trial, ` +
      `7 trials per arm, ${ROUNDS} interleaved rounds\n`,
  );

  const base = rounds[0][ARMS[0]];
  const allSums = rounds.flatMap((r) => ARMS.map((a) => r[a].checksum));
  const agree = allSums.every((c) => Object.is(c, base.checksum));
  console.log("checksum (exact equality across every arm and every round)");
  console.log(`  ${agree ? "ALL EQUAL" : "MISMATCH"}   ${base.checksum.toExponential(17)}`);
  if (!agree) {
    console.log("  CHECKSUMS DIFFER. The arms are not solving the same problem; the rates");
    console.log("  below are not comparable and no conclusion may be drawn from them.");
    for (const arm of ARMS) {
      for (const [i, r] of rounds.entries()) {
        if (!Object.is(r[arm].checksum, base.checksum)) {
          console.log(`    round ${i + 1} ${arm}: ${r[arm].checksum.toExponential(17)}`);
        }
      }
    }
  }
  console.log();

  // The fast/slow split is taken from the pooled distribution rather than
  // per-arm, so it cannot be tuned to make an arm look good: the midpoint of
  // the global range over every arm and every round.
  const pooled = rounds.flatMap((r) => ARMS.map((a) => r[a].median));
  const split = (Math.min(...pooled) + Math.max(...pooled)) / 2;

  console.log(`fast/slow split (midpoint of the pooled range): ${fmt(split)} x10^6 calls/s\n`);
  console.log("rhs throughput, 10^6 calls/s -- peak over rounds, median, and fast-mode hits");
  const peaks = {};
  for (const arm of ARMS) {
    const medians = rounds.map((r) => r[arm].median);
    const st = stats(medians);
    peaks[arm] = st.max;
    const fast = medians.filter((x) => x >= split).length;
    console.log(
      `  ${arm.padEnd(14)} peak ${fmt(st.max)}   median ${fmt(st.median)}` +
        `   fast ${fast}/${ROUNDS}`,
    );
  }
  console.log();

  console.log("every per-round rate, sorted, so the classification above rests on nothing");
  for (const arm of ARMS) {
    const medians = rounds.map((r) => r[arm].median).sort((a, b) => a - b);
    console.log(`  ${arm.padEnd(14)} ${medians.map(fmt).join(" ")}`);
  }
  console.log();

  const controlName = ARMS[1];
  const bias = Math.abs(peaks[controlName] / peaks[ARMS[0]] - 1);
  console.log("peak ratio vs `virtual`");
  for (const arm of ARMS.slice(1)) {
    const ratio = peaks[arm] / peaks[ARMS[0]];
    const note =
      arm === controlName
        ? "   <- CONTROL: true ratio is 1.0 by construction"
        : Math.abs(ratio - 1) <= bias
          ? "   within the control's own bias -- not resolvable"
          : "";
    console.log(`  ${arm.padEnd(14)} ${ratio.toFixed(3)}x${note}`);
  }
  console.log();
  console.log(`Harness bias, from the control: ${(bias * 100).toFixed(1)}%.`);
  if (bias > 0.1) {
    console.log("That exceeds 10%, so no ratio above supports a conclusion (§4 rule 1).");
  } else {
    console.log("A specialised arm means something only if it is further from 1.0 than that");
    console.log("(§4 rule 2). Rule 3 stands on the fast-mode hit counts, not on the ratios.");
  }
}

if (process.argv.includes("--child")) {
  await runChild(process.argv);
} else {
  runParent();
}
