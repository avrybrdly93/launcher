// Shared drift fixture for P2.45 (cross-engine drift measurement).
//
// Deliberately plain JS with only relative imports into the already-built
// `dist/` outputs of @ballista/engine and @ballista/solverkit -- no
// workspace-alias imports, no Node-only APIs (no `node:crypto`, no `fs`).
// That makes this one file usable two ways from the same source:
//   1. imported directly under Node for the reference measurement, and
//   2. bundled by esbuild (platform: "browser") into a self-contained
//      script that runs unmodified inside Chromium/Firefox via Playwright.
// Keeping both paths on identical logic is the point: any drift measured
// downstream reflects genuine cross-engine floating-point differences,
// not a divergence between two hand-maintained fixture implementations.

import {
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
} from "../packages/engine/dist/index.js";
import {
  createDormandPrince54Stepper,
  integrate,
  TrajectoryRecorder,
} from "../packages/solverkit/dist/index.js";

/**
 * Same gravity+quadratic-drag lofted-shot problem as the P2.44 determinism
 * harness, integrated with the adaptive dopri5 stepper so the measurement
 * exercises step-size control (a richer source of cross-engine floating
 * point divergence than a fixed-step method) rather than just the RHS.
 */
export function computeDriftFixtureTrajectory() {
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.0366,
    dragCoefficient: new ConstantCd(0.47),
  });
  const ctx = createEvalContext(env, params);
  const y0 = new Float64Array([0, 1, 40, 30]);

  const recorder = new TrajectoryRecorder();
  const stepper = createDormandPrince54Stepper();
  const report = integrate(
    model,
    ctx,
    y0,
    [0, 3],
    { stepper: "dopri5", maxSteps: 100_000 },
    stepper,
    [recorder],
  );
  if (report.status !== "ok") {
    throw new Error(`drift fixture integration did not complete: status=${report.status}`);
  }

  const trajectory = recorder.trajectory;
  return {
    nSteps: trajectory.nSteps,
    t: Array.from(trajectory.t),
    channels: trajectory.channels.map((channel) => Array.from(channel)),
  };
}
