import {
  dimensionlessPi,
  dragRelaxationTimeLinear,
  type CharacteristicEnvironment,
} from "./characteristic-scales.js";
import { EnvSample } from "./env-sample.js";
import type { ProjectileParams } from "./projectile-params.js";
import { projectileSpecToParams } from "./projectile-spec.js";
import { environmentSpecToEnvironment, type ScenarioSpec } from "./scenario-spec.js";

/**
 * The subset of §4.10's method-selection table this v1 advisor can decide
 * from a `ScenarioSpec` alone. Two of the table's five rows -- "teaching
 * order/convergence" (Euler/RK2/RK4 fixed-step) and "ensembles / Monte
 * Carlo" (fixed-step RK4 or loose RK23) -- describe *how the user is
 * running the solve* (Solver Lab mode, batch mode), not a property of the
 * scenario itself, so no ScenarioSpec-only function can decide them; they
 * stay explicit user/UI choices, out of scope here (P3.24 wires this
 * advisor's output into inline hints alongside whatever mode is active).
 */
export type SolverAdvisorRegime = "stiff" | "conservation-focus" | "default-adaptive";

/** Non-blocking recommendation from `recommendSolver` (§4.10, P2.47). */
export interface SolverAdvisorRecommendation {
  readonly regime: SolverAdvisorRegime;
  /** A `SolverKit` `StepperId` string; not typed against solverkit's `StepperId` to keep engine (L0) free of an L1 dependency (§2.1). */
  readonly recommendedStepperId: string;
  readonly rationale: string;
  /** Present only for the `"stiff"` regime -- the one row in §4.10 that's phrased as a warning, not just a preference. */
  readonly warning?: string;
}

/**
 * A scenario is "stiff" (§4.10, §3.8) when its drag relaxation timescale is
 * far shorter than the flight's own characteristic timescale -- an explicit
 * method must then take steps sized to the fast relaxation, not the slow
 * ballistic arc, to stay stable/accurate. Measured against every P1.36
 * preset: non-stiff presets (shot put, table tennis, golf, baseball) all
 * land at ratio < 5; the dust grain (the blueprint's canonical stiff case)
 * lands at ratio ~2500. 50 sits two orders of magnitude below the stiff
 * case and one above the highest non-stiff case, comfortably inside that
 * gap either way.
 */
const STIFFNESS_RATIO_THRESHOLD = 50;

/**
 * Characteristic drag relaxation time τ for whichever drag force (if any)
 * is wired on the scenario's model, or `Infinity` when none is (drag-free
 * scenarios are never stiff). Linear (Stokes) drag has a state-independent
 * τ = m/(6πηR) (§3.5). Quadratic drag's relaxation time is speed-dependent,
 * τ(v) = m/(ρ·Cd·A·v) (§3.8); evaluated at the launch speed v0, this is
 * exactly `v0 / (2·g·Π)` given Π's definition (§3.6, eq. in
 * `dimensionlessPi`) -- reusing Π rather than recomputing ρ·Cd·A from
 * scratch.
 */
function characteristicDragRelaxationTime(
  forceIds: readonly string[],
  params: ProjectileParams,
  env: CharacteristicEnvironment,
  v0: number,
): number {
  if (v0 <= 0) return Infinity;
  if (forceIds.includes("drag-linear")) {
    return dragRelaxationTimeLinear(params, env);
  }
  if (forceIds.includes("drag-quadratic")) {
    const g = env.g ?? 9.80665;
    const pi = dimensionlessPi(params, env, v0);
    return pi > 0 ? v0 / (2 * g * pi) : Infinity;
  }
  return Infinity;
}

/**
 * Encodes §4.10's method-selection table as a pure function of a
 * `ScenarioSpec`'s own dimensionless character (P2.47): non-blocking
 * guidance a UI can surface as a hint (P3.24), never a gate. Priority
 * order -- `"stiff"` first, since it overrides the general default
 * regardless of which drag model is wired; `"conservation-focus"` next,
 * for the drag-free case where a symplectic method's bounded energy error
 * is the more relevant property than raw speed; `"default-adaptive"`
 * otherwise, the §4.10 "interactive sliders, sports projectiles" row that
 * covers the common case.
 */
export function recommendSolver(spec: ScenarioSpec): SolverAdvisorRecommendation {
  const params = projectileSpecToParams(spec.projectile);
  const environment = environmentSpecToEnvironment(spec.environment);
  const sample = new EnvSample();
  const { x0, y0, vx0, vy0 } = spec.initialConditions;
  environment.sample(0, x0, y0, sample);

  const v0 = Math.hypot(vx0, vy0);
  const g = sample.g;
  const charEnv: CharacteristicEnvironment = {
    rho: sample.rho,
    eta: sample.eta,
    c: sample.c,
    g: sample.g,
  };

  const tau = characteristicDragRelaxationTime(spec.model.forceIds, params, charEnv, v0);
  const stiffnessRatio = v0 > 0 && Number.isFinite(tau) && tau > 0 ? v0 / g / tau : 0;

  if (stiffnessRatio > STIFFNESS_RATIO_THRESHOLD) {
    return {
      regime: "stiff",
      recommendedStepperId: "backward-euler",
      rationale:
        `Drag relaxation time (tau=${tau.toExponential(2)}s) is ${stiffnessRatio.toFixed(0)}x ` +
        `shorter than the flight's characteristic timescale (v0/g) -- an explicit method must ` +
        `crawl to stay stable/accurate here (§3.8, §4.10).`,
      warning:
        "Stiff scenario: consider backward Euler (the reference implicit method), or DOPRI5 " +
        "with step-size telemetry (P2.46) to see the controller's steps collapse during the " +
        "fast transient.",
    };
  }

  const isGravityOnly = spec.model.forceIds.length === 1 && spec.model.forceIds[0] === "gravity";
  if (isGravityOnly) {
    return {
      regime: "conservation-focus",
      recommendedStepperId: "velocity-verlet",
      rationale:
        "Gravity-only (no drag/Magnus/buoyancy wired): a symplectic method conserves energy " +
        "over long horizons instead of drifting secularly (§4.8, §4.10).",
    };
  }

  return {
    regime: "default-adaptive",
    recommendedStepperId: "dopri5",
    rationale:
      "General sports-projectile regime: DOPRI5 at rtol=1e-6 is fast, robust, and needs no " +
      "dense-output workaround (§4.10).",
  };
}
