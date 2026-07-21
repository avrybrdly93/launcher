// SolverKit stepper micro-benchmark + CI trend/regression check (P2.43).
//
// Measures each registered stepper's sustained steps/sec on a shared
// gravity+quadratic-drag planar-projectile problem, expresses it relative
// to explicit-euler on the *same* run (a ratio that is largely
// hardware-invariant, since it mostly reflects rhs-evaluations-per-step
// rather than raw CPU throughput), and compares that ratio against
// scripts/benchmark-baseline.json. A method that regressed more than
// `regressionThresholdPct` prints a GitHub Actions `::warning::`
// annotation (visible in the run's summary) but this script always exits
// 0 -- a deliberate *soft* warn, never a hard CI failure, since perf
// numbers are inherently noisier than correctness tests and a flaky
// regression here should never block a push to main.
//
// Run with `--record` to overwrite the baseline with a fresh measurement
// (e.g. after a deliberate perf-affecting change, or once real numbers
// from the actual CI runner are available) instead of checking it.
//
// Requires `packages/{engine,solverkit}/dist` to already be built
// (`pnpm typecheck` / `tsc -b`, already a prior CI step) since this is a
// plain Node script, not a TS-aware one.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");
const baselinePath = join(rootDir, "scripts", "benchmark-baseline.json");

const { benchmarkStepper } = await import(
  join(rootDir, "packages", "solverkit", "dist", "micro-benchmark.js")
);
const {
  ExplicitEulerStepper,
  MidpointRK2Stepper,
  HeunRK2Stepper,
  ClassicalRK4Stepper,
  SemiImplicitEulerStepper,
  VerletStepper,
  createBogackiShampine32Stepper,
  createDormandPrince54Stepper,
} = await import(join(rootDir, "packages", "solverkit", "dist", "index.js"));
const {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} = await import(join(rootDir, "packages", "engine", "dist", "index.js"));

const REFERENCE_METHOD = "explicit-euler";
const REGRESSION_THRESHOLD_PCT = 15;
const MIN_DURATION_MS = 300;
const WARMUP_STEPS = 20_000;
const TRIALS_PER_METHOD = 3;

const STEPPER_FACTORIES = [
  () => new ExplicitEulerStepper(),
  () => new MidpointRK2Stepper(),
  () => new HeunRK2Stepper(),
  () => new ClassicalRK4Stepper(),
  () => new SemiImplicitEulerStepper(),
  () => new VerletStepper("velocity"),
  () => new VerletStepper("position"),
  () => createBogackiShampine32Stepper(),
  () => createDormandPrince54Stepper(),
];

function createProblemFixture() {
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  return { model, ctx, y0: new Float64Array([0, 100, 20, 0]), h: 0.001 };
}

/** Best-of-`TRIALS_PER_METHOD` steps/sec: throughput noise mostly adds slowdown (scheduler/GC jitter), so max denoises without hiding a genuine regression. */
function measureBestStepsPerSec(factory, fixture) {
  let best = { id: "", stepsPerSec: 0 };
  for (let trial = 0; trial < TRIALS_PER_METHOD; trial++) {
    const result = benchmarkStepper(
      factory(),
      fixture.model,
      fixture.ctx,
      fixture.y0,
      fixture.h,
      MIN_DURATION_MS,
      WARMUP_STEPS,
    );
    if (result.stepsPerSec > best.stepsPerSec) best = result;
  }
  return best;
}

const fixture = createProblemFixture();
const measured = STEPPER_FACTORIES.map((factory) => measureBestStepsPerSec(factory, fixture));
const referenceRate = measured.find((r) => r.id === REFERENCE_METHOD)?.stepsPerSec;
if (!referenceRate) {
  console.error(`Reference method "${REFERENCE_METHOD}" not found among measured steppers.`);
  process.exit(1);
}

const current = {};
for (const r of measured) {
  current[r.id] = {
    stepsPerSec: Math.round(r.stepsPerSec),
    relativeToEuler: +(r.stepsPerSec / referenceRate).toFixed(4),
  };
}

if (process.argv.includes("--record")) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  baseline.recordedAt = new Date().toISOString().slice(0, 10);
  baseline.methods = current;
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Recorded a fresh baseline to ${baselinePath}.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const threshold = baseline.regressionThresholdPct ?? REGRESSION_THRESHOLD_PCT;

console.log(
  `SolverKit stepper micro-benchmark (steps/sec, relative to ${REFERENCE_METHOD}; baseline recorded ${baseline.recordedAt}):`,
);
const regressions = [];
for (const [id, currentEntry] of Object.entries(current)) {
  const baselineEntry = baseline.methods[id];
  const line = `  ${id.padEnd(24)} ${String(currentEntry.stepsPerSec).padStart(10)} steps/sec  ratio=${currentEntry.relativeToEuler.toFixed(4)}`;
  if (!baselineEntry) {
    console.log(`${line}  (no baseline entry -- new method, not gated)`);
    continue;
  }
  const regressionPct =
    ((baselineEntry.relativeToEuler - currentEntry.relativeToEuler) /
      baselineEntry.relativeToEuler) *
    100;
  console.log(
    `${line}  baseline=${baselineEntry.relativeToEuler.toFixed(4)}  regression=${regressionPct.toFixed(1)}%`,
  );
  if (regressionPct > threshold) {
    regressions.push({
      id,
      regressionPct,
      baseline: baselineEntry.relativeToEuler,
      current: currentEntry.relativeToEuler,
    });
  }
}

if (regressions.length > 0) {
  for (const r of regressions) {
    const message = `Benchmark regression: "${r.id}" is ${r.regressionPct.toFixed(1)}% slower relative to ${REFERENCE_METHOD} than the recorded baseline (baseline ratio=${r.baseline.toFixed(4)}, current=${r.current.toFixed(4)}, threshold=${threshold}%).`;
    console.warn(`::warning::${message}`);
  }
  console.warn(
    `${regressions.length} method(s) regressed beyond ${threshold}% -- soft warn only, not failing CI.`,
  );
} else {
  console.log("No method regressed beyond the threshold.");
}

// Soft warn (P2.43's own validation text): a regression is flagged loudly
// above, but this script always exits 0 so a noisy CI runner never blocks
// a push to main over a perf measurement.
process.exit(0);
