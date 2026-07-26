/**
 * Energy-drift dashboard shell harness (§7 P3.44; full content and
 * automated shape assertions are P4.12, blueprint §4.8 "flagship comparison
 * exhibit"). Runs Explicit Euler, Classical RK4, semi-implicit (symplectic)
 * Euler, and velocity Verlet on the gravity-only `DEFAULT_SCENARIO` at a
 * shared *fixed RHS-evaluation budget* (§4.8: "fixed cost budget (equal RHS
 * evaluations)"), each landing at the same `tFinal` (a tight-tolerance
 * DOPRI5 reference solve's own natural landing time, mirroring
 * `solver-lab.ts`'s reference-solve pattern) via a per-method `h` chosen so
 * `nSteps * rhsPerStep === RHS_BUDGET`. Each method's trace is `E(t)/E(0) -
 * 1` (`mechanicalEnergy`, `@ballista/engine`) sampled at every accepted
 * step -- these are genuine solver runs ("pinned runs"), not canned
 * fixture data, so this task's validation criterion ("four-method E(t)
 * traces render from pinned runs") holds by construction.
 *
 * Verlet/semi-implicit-Euler are instantiated directly here rather than
 * through `scenario-resolver.ts`'s `resolveStepper` -- per that module's
 * own docs, generic wiring of geometric/implicit steppers into an
 * arbitrary committed `ScenarioSpec` is P4.10's concern. This exhibit only
 * ever runs the fixed `DEFAULT_SCENARIO` (gravity-only, so
 * `model.partitions`'s q/p split is exact for Verlet regardless), which
 * sidesteps that generality question entirely.
 */

import { mechanicalEnergy, type ScenarioSpec } from "@ballista/engine";
import {
  SemiImplicitEulerStepper,
  TrajectoryRecorder,
  VerletStepper,
  integrate,
  type Stepper,
} from "@ballista/solverkit";
import { resolveModel, resolveStepper } from "./scenario-resolver.js";
import { DEFAULT_SCENARIO } from "./simulation-session.js";

const T_MAX_SECONDS = 60;
const REFERENCE_STEPPER_ID = "dopri5";
const REFERENCE_RTOL = 1e-12;
const REFERENCE_ATOL = 1e-12;

/**
 * Total rhs evaluations every method below is budgeted, `nSteps` derived
 * per method from its own `rhsPerStep` cost -- the "fixed cost budget"
 * §4.8 asks for. Divisible cleanly by every listed `rhsPerStep` (1, 2, 4)
 * so no method's derived `nSteps` needs rounding.
 */
const RHS_BUDGET = 800;

/** The four methods this exhibit compares, in display order, with the exact per-step rhs-evaluation cost `RHS_BUDGET` is divided by. */
const ENERGY_DRIFT_METHODS: readonly {
  readonly id: string;
  readonly label: string;
  readonly rhsPerStep: number;
  readonly build: () => Stepper;
}[] = [
  {
    id: "explicit-euler",
    label: "Explicit Euler",
    rhsPerStep: 1,
    build: () => resolveStepper("explicit-euler"),
  },
  {
    id: "classical-rk4",
    label: "Classical RK4",
    rhsPerStep: 4,
    build: () => resolveStepper("classical-rk4"),
  },
  {
    id: "semi-implicit-euler",
    label: "Symplectic Euler",
    rhsPerStep: 1,
    build: () => new SemiImplicitEulerStepper(),
  },
  {
    id: "velocity-verlet",
    label: "Velocity Verlet",
    rhsPerStep: 2,
    build: () => new VerletStepper("velocity"),
  },
];

/** One method's E(t)/E(0)-1 trace, sampled at every accepted step of its own fixed-h run. */
export interface EnergyDriftMethodTrace {
  readonly stepperId: string;
  readonly label: string;
  readonly symplectic: boolean;
  readonly h: number;
  readonly nSteps: number;
  readonly nRHS: number;
  readonly t: Float64Array;
  readonly relativeEnergyError: Float64Array;
}

/** Full energy-drift study: the shared landing time every method ran to, plus each method's trace. */
export interface EnergyDriftStudy {
  readonly tFinal: number;
  readonly methods: readonly EnergyDriftMethodTrace[];
}

/**
 * Runs the energy-drift exhibit for `scenario` (default: `DEFAULT_SCENARIO`,
 * the gravity-only drag-free reference §4.8 calls for). `scenario.model`
 * must declare `partitions` (true of every `planarProjectileModel`,
 * P1.19/P1.40) since Verlet/semi-implicit-Euler require it.
 */
export function runEnergyDriftStudy(scenario: ScenarioSpec = DEFAULT_SCENARIO): EnergyDriftStudy {
  const { model, ctx, y0 } = resolveModel(scenario);

  const referenceStepper = resolveStepper(REFERENCE_STEPPER_ID);
  const referenceReport = integrate(
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
    referenceStepper,
  );
  const tFinal = referenceReport.tFinal;

  const e0 = mechanicalEnergy(y0, ctx);
  const row = new Float64Array(model.dim);

  const methods = ENERGY_DRIFT_METHODS.map(
    ({ id, label, rhsPerStep, build }): EnergyDriftMethodTrace => {
      const nSteps = RHS_BUDGET / rhsPerStep;
      const h = tFinal / nSteps;

      const stepper = build();
      const recorder = new TrajectoryRecorder(nSteps + 1);
      const report = integrate(
        model,
        ctx,
        y0,
        [0, tFinal],
        { stepper: id, h, maxSteps: Number.MAX_SAFE_INTEGER },
        stepper,
        [recorder],
      );

      const trajectory = recorder.trajectory;
      const relativeEnergyError = new Float64Array(trajectory.nSteps);
      for (let i = 0; i < trajectory.nSteps; i++) {
        for (let c = 0; c < model.dim; c++) row[c] = trajectory.channels[c]![i]!;
        relativeEnergyError[i] = mechanicalEnergy(row, ctx) / e0 - 1;
      }

      return {
        stepperId: id,
        label,
        symplectic: stepper.info.symplectic,
        h,
        nSteps: report.nSteps,
        nRHS: report.nRHS,
        t: trajectory.t,
        relativeEnergyError,
      };
    },
  );

  return { tFinal, methods };
}
