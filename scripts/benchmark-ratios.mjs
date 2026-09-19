// The measurement half of P7.31's --record path, split out of
// check-benchmark-regression.mjs's script body so that appending a trend sample
// and checking against the baseline measure the SAME THING rather than two
// things that look alike.
//
// Deliberately a thin re-use: this module owns no methodology. The stepper
// list, the trial count and the best-of-N rule all live in
// packages/solverkit/dist/micro-benchmark.js and in the constants below, which
// are copied from check-benchmark-regression.mjs and must stay equal to them --
// packages/solverkit/src/benchmark-trend.test.ts asserts that they do, so a
// change to one that is not made to the other fails rather than producing a
// series with a silent methodology change in the middle of it.

import { join } from "node:path";

export const REFERENCE_METHOD = "explicit-euler";
export const MIN_DURATION_MS = 300;
export const WARMUP_STEPS = 20_000;
export const TRIALS_PER_METHOD = 3;

/** Measure every registered stepper and return ratios plus absolute rates. */
export async function measureStepperRatios(rootDir) {
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

  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  const y0 = new Float64Array([0, 100, 20, 0]);
  const h = 0.001;

  const factories = [
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

  const measured = factories.map((factory) => {
    let best = { id: "", stepsPerSec: 0 };
    for (let trial = 0; trial < TRIALS_PER_METHOD; trial++) {
      const result = benchmarkStepper(factory(), model, ctx, y0, h, MIN_DURATION_MS, WARMUP_STEPS);
      if (result.stepsPerSec > best.stepsPerSec) best = result;
    }
    return best;
  });

  const referenceRate = measured.find((r) => r.id === REFERENCE_METHOD)?.stepsPerSec;
  if (!referenceRate) throw new Error(`reference method "${REFERENCE_METHOD}" was not measured`);

  const ratios = {};
  const stepsPerSec = {};
  for (const r of measured) {
    ratios[r.id] = +(r.stepsPerSec / referenceRate).toFixed(4);
    stepsPerSec[r.id] = Math.round(r.stepsPerSec);
  }
  return { ratios, stepsPerSec };
}
