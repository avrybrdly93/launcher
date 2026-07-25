/**
 * Stability-explorer harness (§7 P3.43, blueprint §4.6 "the Solver Lab
 * renders |R(z)|=1 contours interactively and overlays the actual
 * eigenvalues h*lambda_i of the current scenario's Jacobian along the
 * trajectory, animating how z migrates as the projectile decelerates").
 *
 * This module owns the physics half: running a scenario once at high
 * fidelity, then walking the recorded trajectory to extract, at each
 * sampled row, the velocity-block eigenvalues of the model's Jacobian
 * (analytic per P1.22 where available, else P1.23's finite-difference
 * fallback) via {@link eigenvalues2x2} -- exactly the 2x2 sub-block eq. 4.12
 * calls out ("velocity-block eigenvalues lambda ~ -rho*Cd*A*u/m * {1, 1/2}").
 * Combining a sampled eigenvalue with a chosen step size h into z = h*lambda,
 * and building the R(z)-contour figure to overlay it on, is a viz-layer
 * concern (`buildStabilityRegionFigure`, `@ballista/viz`) -- this module
 * only ever returns raw lambda, never z, so the same samples serve any h the
 * UI's slider picks without re-solving.
 */

import {
  finiteDifferenceJacobian,
  type EvalContext,
  type Model,
  type ScenarioSpec,
} from "@ballista/engine";
import { eigenvalues2x2, integrate, TrajectoryRecorder, type Complex } from "@ballista/solverkit";
import { resolveModel, resolveStepper } from "./scenario-resolver.js";

const T_MAX_SECONDS = 60;
const REFERENCE_STEPPER_ID = "dopri5";
const REFERENCE_RTOL = 1e-9;
const REFERENCE_ATOL = 1e-9;
const DEFAULT_SAMPLE_COUNT = 40;

/**
 * Every stability-explorer method option: `order` is the stage count whose
 * truncated-exponential stability polynomial (eq. 4.11) is exact for this
 * stepper (`stabilityFunction`, `@ballista/solverkit`) -- deliberately the
 * same four low-stage methods `stabilityFunction` documents support for,
 * not the full `resolveStepper` roster (Bogacki-Shampine 3(2) and
 * Dormand-Prince 5(4) have more stages than their order, so their true
 * R(z) is a different, higher-degree polynomial this module does not
 * compute).
 */
export const STABILITY_EXPLORER_METHOD_OPTIONS: readonly {
  readonly id: string;
  readonly label: string;
  readonly order: number;
}[] = [
  { id: "explicit-euler", label: "Explicit Euler", order: 1 },
  { id: "midpoint-rk2", label: "Midpoint RK2", order: 2 },
  { id: "heun-rk2", label: "Heun RK2", order: 2 },
  { id: "classical-rk4", label: "Classical RK4", order: 4 },
];

/** One trajectory sample's velocity-block eigenvalue pair, plus enough context to label/scrub it. */
export interface EigenvalueSample {
  readonly t: number;
  /** Speed |v| at this sample -- the quantity eq. 4.12 says the eigenvalues track ("eigenvalues move as the projectile decelerates"). */
  readonly speed: number;
  readonly lambda: readonly [Complex, Complex];
}

export interface StabilityExplorerResult {
  readonly tFinal: number;
  readonly samples: readonly EigenvalueSample[];
}

/** Refreshes `ctx` by sampling the environment at `(t, y)` (via one throwaway rhs call) before reading a Jacobian -- the same "env is only current immediately after rhs runs for this state" rule `mechanicalEnergy` relies on (`planar-projectile-model.ts`). */
function refreshCtxAndJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  rhsScratch: Float64Array,
  jacobian: Float64Array,
): void {
  model.rhs(t, y, rhsScratch, ctx);
  if (model.jacobian) {
    model.jacobian(t, y, ctx, jacobian);
  } else {
    finiteDifferenceJacobian(model, t, y, ctx, jacobian);
  }
}

/**
 * Runs `spec` once at high fidelity (mirrors `convergence-study.ts`'s
 * tight-tolerance-DOPRI5-to-the-scenario's-own-event-time reference solve),
 * then samples `sampleCount` evenly spaced rows of the recorded trajectory
 * (always including the first and last), extracting the velocity-block
 * Jacobian eigenvalues at each. `vxIndex`/`vyIndex` are read from
 * `model.channels` by name rather than assumed positions, so this stays
 * correct if a future model's channel order ever differs from
 * `planarProjectileModel`'s `[x, y, vx, vy]`.
 */
export function sampleTrajectoryEigenvalues(
  spec: ScenarioSpec,
  sampleCount: number = DEFAULT_SAMPLE_COUNT,
): StabilityExplorerResult {
  if (sampleCount < 2) {
    throw new Error(`sampleTrajectoryEigenvalues: sampleCount must be >= 2, got ${sampleCount}`);
  }

  const { model, ctx, y0 } = resolveModel(spec);
  const vxIndex = model.channels.findIndex((c) => c.name === "vx");
  const vyIndex = model.channels.findIndex((c) => c.name === "vy");
  if (vxIndex < 0 || vyIndex < 0) {
    throw new Error('sampleTrajectoryEigenvalues: model.channels has no "vx"/"vy" channel');
  }

  const stepper = resolveStepper(REFERENCE_STEPPER_ID);
  const recorder = new TrajectoryRecorder();
  const report = integrate(
    model,
    ctx,
    y0,
    [0, T_MAX_SECONDS],
    {
      stepper: REFERENCE_STEPPER_ID,
      rtol: REFERENCE_RTOL,
      atol: REFERENCE_ATOL,
      maxSteps: Number.MAX_SAFE_INTEGER,
    },
    stepper,
    [recorder],
  );

  const trajectory = recorder.trajectory;
  const lastRow = trajectory.nSteps - 1;
  const rhsScratch = new Float64Array(model.dim);
  const jacobian = new Float64Array(model.dim * model.dim);
  const y = new Float64Array(model.dim);

  const samples: EigenvalueSample[] = [];
  for (let s = 0; s < sampleCount; s++) {
    const row = lastRow === 0 ? 0 : Math.round((s * lastRow) / (sampleCount - 1));
    const t = trajectory.t[row]!;
    for (let c = 0; c < model.dim; c++) y[c] = trajectory.channels[c]![row]!;

    refreshCtxAndJacobian(model, t, y, ctx, rhsScratch, jacobian);

    const dim = model.dim;
    const a = jacobian[vxIndex * dim + vxIndex]!;
    const b = jacobian[vxIndex * dim + vyIndex]!;
    const c = jacobian[vyIndex * dim + vxIndex]!;
    const d = jacobian[vyIndex * dim + vyIndex]!;
    const lambda = eigenvalues2x2(a, b, c, d);

    samples.push({ t, speed: Math.hypot(y[vxIndex]!, y[vyIndex]!), lambda });
  }

  return { tFinal: report.tFinal, samples };
}
