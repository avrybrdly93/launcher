// P0.127: an independent re-derivation of P7.03's throughput ceiling.
//
// WHAT THIS ANSWERS, AND WHY IT IS A SCRIPT RATHER THAN A PARAGRAPH. P7.03's
// validation criterion is ">=3x throughput vs naive loop (measured)". The 85th
// run built the batched kernel, measured 1.07x / 1.04x / 1.00x against
// `stepEnsembleReference`, decomposed the reference step, and concluded that
// `Model.rhs` is ~59% of it -- so 1.69x is the hard ceiling for deleting every
// scrap of non-rhs work, and the criterion asks for a number above its own
// ceiling.
//
// P0.127's own notes say that arithmetic "is arithmetic on this run's single
// measurement, not a second measurement, and should be re-derived rather than
// quoted". A decision that retargets a validation criterion cannot rest on a
// number nobody can re-run, so the re-derivation is a committed script rather
// than a scratch file: the next person to doubt the decision can re-measure it
// in one command instead of rebuilding the harness from a changelog entry.
//
// WHAT IT MEASURES. Four quantities on one fixture, at several batch sizes:
//
//   1. `reference`  -- steps/sec of `stepEnsembleReference`, the naive loop
//                      P7.03's criterion names.
//   2. `batched`    -- steps/sec of `stepEnsembleBatched`, and the speedup.
//   3. `rhsOnly`    -- steps/sec of a loop that makes exactly the rhs calls
//                      the reference makes (stages x replicates) and does
//                      nothing else. This is the irreducible part.
//   4. `ceiling`    -- `rhsOnly / reference`. The most any rearrangement of
//                      the surrounding arithmetic could return, since the rhs
//                      call count is identical in both kernels and the rhs
//                      rate is what remains when everything else is deleted.
//                      This is P7.03's ceiling: it holds `Model.rhs` fixed.
//   5. `freeRhs`    -- the reference loop driving a model whose rhs is empty,
//                      and `rhsCeiling` = `freeRhs / reference`. This is the
//                      OTHER end: the most that making the rhs infinitely
//                      cheap could return with the loop structure unchanged.
//                      It bounds P7.04 and P7.05 the way `ceiling` bounds
//                      P7.03, and the two together bound what the TypeScript
//                      path can do at all -- which is the question P0.127 has
//                      to answer before moving a 3x anywhere.
//
// WHY THE rhs-ONLY LOOP IS A FAIR LOWER BOUND AND NOT A STRAW MAN. It gathers
// each replicate's state into the same contiguous buffer the reference gathers
// into, because §3.7's `Model.rhs` takes a contiguous `Float64Array` and no
// arrangement of the batch avoids materializing one. It then calls `rhs` the
// same number of times, on the same model, with the same context. What it
// omits is exactly what a perfect batched kernel would be optimizing: the
// stage-input assembly, the combine, the scatter, and the per-stage
// bookkeeping. So `ceiling` is an upper bound on the achievable speedup by
// construction, not an estimate of one.
//
// THE FIXTURE IS THE REAL PROJECTILE MODEL, gravity plus quadratic drag,
// because the ensemble machinery exists for Monte Carlo studies of real
// flights, and the choice of model decides the answer. A trivial two-line rhs
// is measured alongside it as a contrast, and the contrast is the point: a
// cheap rhs is a smaller share of the step, so a *larger* share is overhead, so
// the ceiling is HIGHER. Measured, the trivial model's ceiling reaches ~3 at 64
// replicates while the projectile's sits at ~2. A criterion of 3x is therefore
// not absurd in the abstract -- it is unreachable on the models this repository
// actually integrates, which is a different and more useful statement.
//
// SOFT: this script measures and prints. It gates nothing, writes nothing, and
// exits 0 unless it throws. Absolute rates on a shared runner are not a signal
// a build should be gated on -- the same reasoning the repository's other
// three perf scripts already carry.
//
// Usage:
//   node scripts/measure-ensemble-step-decomposition.mjs [--replicates 64,256,1024]

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ENTRY = `
export {
  createPlanarProjectileModel,
  createEvalContext,
  createSphericalProjectileParams,
  ConstantCd,
  ConstantAtmosphere,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  G_STD,
} from "@ballista/engine";
export {
  createEnsembleLayout,
  createEnsembleBlock,
  createEnsembleStepBuffers,
  stepEnsembleReference,
  createBatchedEnsembleBuffers,
  stepEnsembleBatched,
  stateIndex,
  RK4_TABLEAU,
} from "@ballista/solverkit";
`;

async function loadWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ballista-decomp-"));
  const out = join(dir, "bundle.mjs");
  // `stdin.resolveDir` is `packages/validation`, not this script's directory
  // and not the temp dir. pnpm links workspace packages under each consuming
  // package's own `node_modules` rather than at the repo root, so
  // `@ballista/engine` resolves from inside a package that depends on it and
  // nowhere else -- `scripts/` included. `validation` is used because it
  // already depends on both packages this script imports and adds no
  // dependency to do so. The bundle itself lands outside the repo, so nothing
  // generated is ever committed.
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

/** Median steps/sec over `trials` timed repetitions, after a warm-up. */
function measure(run, stepsPerCall, { warmup = 3, trials = 7 } = {}) {
  for (let i = 0; i < warmup; i++) run();
  const rates = [];
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    run();
    const elapsed = performance.now() - t0;
    rates.push((stepsPerCall / elapsed) * 1000);
  }
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

function projectileFixture(m) {
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
  return {
    label: "planar projectile, gravity + quadratic drag",
    model: m.createPlanarProjectileModel([new m.GravityForce(), new m.QuadraticDragForce()]),
    ctx: m.createEvalContext(environment, params),
    seed: (r) => [0, 1 + 0.001 * r, 60 + 0.01 * r, 45 + 0.01 * r],
  };
}

function trivialFixture(m, dim) {
  return {
    label: `trivial ${dim}-channel rhs (contrast only)`,
    model: {
      dim,
      channels: Array.from({ length: dim }, (_, i) => ({ name: `c${i}`, unit: "1" })),
      rhs(_t, y, out) {
        for (let i = 0; i < dim; i++) out[i] = -0.1 * y[i];
      },
    },
    ctx: m.createEvalContext(
      new m.Environment(
        new m.UniformGravity(m.G_STD),
        new m.ConstantAtmosphere(1.225),
        new m.ZeroWind(),
      ),
      m.createSphericalProjectileParams({
        mass: 5,
        radius: 0.05,
        dragCoefficient: new m.ConstantCd(0.47),
      }),
    ),
    seed: (r) => Array.from({ length: dim }, (_, i) => 1 + 0.001 * (r + i)),
  };
}

function fillBlock(m, block, layout, seed) {
  for (let r = 0; r < layout.replicates; r++) {
    const row = seed(r);
    for (let c = 0; c < layout.stateDim; c++) {
      block.data[m.stateIndex(layout, c, r)] = row[c];
    }
  }
}

function runFixture(m, fixture, replicates, steps) {
  const dim = fixture.model.dim;
  const tableau = m.RK4_TABLEAU;
  const stages = tableau.c.length;
  const layout = m.createEnsembleLayout(replicates, 0, dim);

  const refBlock = m.createEnsembleBlock(layout);
  const refBuffers = m.createEnsembleStepBuffers(layout, stages);
  const batBlock = m.createEnsembleBlock(layout);
  const batBuffers = m.createBatchedEnsembleBuffers(layout, stages);

  // The rhs-only lower bound: the same gather into a contiguous buffer that
  // §3.7 forces, then exactly `stages` rhs calls per replicate.
  const rhsBlock = m.createEnsembleBlock(layout);
  const y = new Float64Array(dim);
  const out = new Float64Array(dim);

  // The other end of the budget: the identical reference loop, driving a model
  // whose rhs does nothing. An empty function is the cheapest an rhs can
  // possibly be, so this is an upper bound on any rhs work -- a specializer, a
  // monomorphic call site, or removing the call entirely.
  const freeBlock = m.createEnsembleBlock(layout);
  const freeBuffers = m.createEnsembleStepBuffers(layout, stages);
  const freeModel = {
    dim,
    channels: fixture.model.channels,
    rhs() {},
  };

  const h = 0.01;

  const reset = () => {
    fillBlock(m, refBlock, layout, fixture.seed);
    fillBlock(m, batBlock, layout, fixture.seed);
    fillBlock(m, rhsBlock, layout, fixture.seed);
    fillBlock(m, freeBlock, layout, fixture.seed);
  };

  const referenceRun = () => {
    reset();
    for (let s = 0; s < steps; s++) {
      m.stepEnsembleReference(fixture.model, fixture.ctx, refBlock, refBuffers, s * h, h, {
        tableau,
      });
    }
  };
  const batchedRun = () => {
    reset();
    for (let s = 0; s < steps; s++) {
      m.stepEnsembleBatched(fixture.model, fixture.ctx, batBlock, batBuffers, s * h, h, {
        tableau,
      });
    }
  };
  const rhsOnlyRun = () => {
    reset();
    for (let s = 0; s < steps; s++) {
      const t = s * h;
      for (let r = 0; r < replicates; r++) {
        for (let c = 0; c < dim; c++) y[c] = rhsBlock.data[m.stateIndex(layout, c, r)];
        for (let stage = 0; stage < stages; stage++) {
          fixture.model.rhs(t, y, out, fixture.ctx);
        }
      }
    }
  };

  // Bit-identity is not this script's subject, but the two kernels must be
  // stepping the same problem or the ratio means nothing. Checked once, before
  // any timing, on a snapshot: `batchedRun` calls `reset` too, so comparing
  // the live blocks after it would compare a stepped batch against a freshly
  // re-seeded reference and report a difference that is entirely the harness's.
  // (It did, on the first run of this script.)
  referenceRun();
  const referenceEnd = Float64Array.from(refBlock.data);
  batchedRun();
  let identical = referenceEnd.length === batBlock.data.length;
  for (let i = 0; identical && i < referenceEnd.length; i++) {
    if (!Object.is(referenceEnd[i], batBlock.data[i])) identical = false;
  }

  const freeRhsRun = () => {
    reset();
    for (let s = 0; s < steps; s++) {
      m.stepEnsembleReference(freeModel, fixture.ctx, freeBlock, freeBuffers, s * h, h, {
        tableau,
      });
    }
  };

  const reference = measure(referenceRun, steps);
  const batched = measure(batchedRun, steps);
  const rhsOnly = measure(rhsOnlyRun, steps);
  const freeRhs = measure(freeRhsRun, steps);

  return {
    replicates,
    reference,
    batched,
    rhsOnly,
    speedup: batched / reference,
    rhsFraction: reference / rhsOnly,
    // The ceiling is `rhsOnly / reference`, not `1 / (1 - share)`.
    //
    // Deleting every scrap of non-rhs work leaves a kernel running at the
    // rhs-only rate, so the best achievable speedup is that rate over the
    // reference's -- which is also `1 / share`, since the share is
    // `reference / rhsOnly` as a ratio of times. The first version of this
    // script wrote `1 / (1 - share)`, which is Amdahl's law for deleting the
    // *rhs* and keeping everything else: the exact inverse of the question.
    // It went unnoticed for three runs because the projectile fixture's share
    // sits near 0.5, where the two expressions nearly coincide (1.98 against
    // 2.02 at 1024 replicates). The trivial fixture, whose share is ~0.33, is
    // what made them disagree visibly.
    ceiling: reference === 0 ? Infinity : rhsOnly / reference,
    freeRhs,
    rhsCeiling: reference === 0 ? Infinity : freeRhs / reference,
    identical,
  };
}

function report(fixture, rows) {
  console.log(`\n${fixture.label}`);
  console.log(
    "  replicates   ref steps/s   bat steps/s   speedup   rhs share   P7.03 ceiling   free-rhs ceiling",
  );
  for (const row of rows) {
    console.log(
      `  ${String(row.replicates).padStart(9)}   ${row.reference.toFixed(1).padStart(11)}   ` +
        `${row.batched.toFixed(1).padStart(11)}   ${row.speedup.toFixed(3).padStart(7)}   ` +
        `${(row.rhsFraction * 100).toFixed(1).padStart(8)}%   ` +
        `${row.ceiling.toFixed(2).padStart(13)}   ${row.rhsCeiling.toFixed(2).padStart(16)}`,
    );
  }
  console.log(`  bit-identical to the reference: ${rows[0].identical ? "yes" : "NO"}`);
}

async function main() {
  const arg = process.argv.indexOf("--replicates");
  const replicateList =
    arg >= 0 && process.argv[arg + 1]
      ? process.argv[arg + 1].split(",").map((s) => Number.parseInt(s, 10))
      : [64, 256, 1024];

  const { mod, cleanup } = await loadWorkspace();
  try {
    console.log("P0.127 -- ensemble step decomposition, RK4, 4 stages.");
    console.log("`ceiling` is rhs-only/ref: the most that deleting ALL non-rhs work returns.");

    for (const fixture of [projectileFixture(mod), trivialFixture(mod, 2)]) {
      const rows = [];
      for (const replicates of replicateList) {
        // Hold the total work roughly constant across batch sizes.
        const steps = Math.max(4, Math.round(65536 / replicates));
        rows.push(runFixture(mod, fixture, replicates, steps));
      }
      report(fixture, rows);
    }
  } finally {
    cleanup();
  }
}

await main();
