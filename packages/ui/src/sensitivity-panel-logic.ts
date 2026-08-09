/**
 * Sensitivity-channels panel's non-rendering logic (P5.11: live `dR/dv₀`,
 * `dR/dθ`, `dR/dC_d` readouts). Split from the `.tsx` for the same reason
 * `forces-panel-logic.ts` is: the numbers are the substance here, and they are
 * worth testing without a DOM in the way.
 *
 * **Every value comes from P5.10's tangent-linear solve, never from a finite
 * difference.** `tangent-linear.ts` exists precisely because differencing an
 * *adaptive* solve carries a noise floor set by the integration tolerance
 * rather than by machine epsilon (`shooting-jacobian.ts` explains why at
 * length), and a readout that updates on every scenario commit is the worst
 * possible place to inherit that floor: the user would see the last digits
 * flicker as the controller picked different step sequences for two aims that
 * differ in the sixth decimal.
 *
 * **What is differentiated is the impact `x` coordinate, not `range()`.**
 * `rangeSensitivity` reads the downrange channel of the total impact
 * derivative, whereas `observables.ts`'s `range` is `|x_imp − x₀|`. The two
 * agree in sign and magnitude for a shot launched downrange, which is every
 * scenario this panel is reachable from, and they would disagree for a shot
 * travelling in −x. That is a property of the analysis module, restated here
 * rather than papered over, because the panel's label says "range".
 */

import {
  type EvalContext,
  type ScenarioSpec,
  createEvalContext,
  environmentSpecToEnvironment,
  projectileSpecToParams,
} from "@ballista/engine";
import {
  type Aim,
  type ShootingProblem,
  type TangentParameter,
  PLANAR_LAYOUT,
  aimParameters,
  createTangentLinearFlight,
  rangeSensitivity,
} from "@ballista/analysis";
import { resolveModel, resolveSolverConfig } from "@ballista/runtime";
import { createDormandPrince54Stepper } from "@ballista/solverkit";

/** The three channels §7's P5.11 row names, in the panel's row order. */
export type SensitivityChannelId = "theta" | "speed" | "cd";

export interface SensitivityChannel {
  readonly id: SensitivityChannelId;
  /** Row label, e.g. `dR/dθ`. */
  readonly label: string;
  /** Unit of the derivative, e.g. `m/rad`. */
  readonly unit: string;
  /** One-line gloss of what the number means, rendered as the row's title. */
  readonly description: string;
}

export const SENSITIVITY_CHANNELS: readonly SensitivityChannel[] = Object.freeze([
  Object.freeze({
    id: "theta" as const,
    label: "dR/dθ",
    unit: "m/rad",
    description: "Change in range per radian of elevation. Zero at the optimal angle.",
  }),
  Object.freeze({
    id: "speed" as const,
    label: "dR/dv₀",
    unit: "m/(m/s)",
    description: "Change in range per unit of launch speed.",
  }),
  Object.freeze({
    id: "cd" as const,
    label: "dR/dC_d",
    unit: "m",
    description: "Change in range per unit of drag coefficient. Negative: more drag, less range.",
  }),
]);

/** One row's state: a number, or a stated reason there isn't one. */
export type ChannelReadout =
  | { readonly id: SensitivityChannelId; readonly status: "ok"; readonly value: number }
  | { readonly id: SensitivityChannelId; readonly status: "unavailable"; readonly reason: string };

export interface SensitivityReadout {
  /** One entry per {@link SENSITIVITY_CHANNELS} row, in that order. */
  readonly channels: readonly ChannelReadout[];
  /** The `(θ, v₀)` the scenario's launch velocity resolves to. `null` when it does not resolve to one. */
  readonly aim: Aim | null;
  /** Flight time of the sensitivity solve, seconds. `null` when it did not reach impact. */
  readonly timeOfFlight: number | null;
  /**
   * Why every channel is unavailable at once — an unsupported model kind, a
   * degenerate aim, or a solve that never reached the ground. `null` when the
   * solve produced numbers.
   */
  readonly failure: string | null;
  /**
   * Set when the scenario's own stepper is not the one the sensitivity solve
   * ran. See {@link sensitivityProblem}: this is a real caveat, not a footnote,
   * because it means the readouts describe the exact dynamics while the canvas
   * shows an approximation of them.
   */
  readonly stepperNote: string | null;
}

/**
 * The scenario's launch velocity as an aim.
 *
 * `ScenarioSpec` stores `(vx₀, vy₀)` and the tangent-linear parameters are
 * `(θ, v₀)`, so this conversion has to happen somewhere; doing it here keeps
 * `aimParameters`' seeding convention — the one thing `tangent-linear.ts`
 * warns is dangerous to duplicate — untouched.
 *
 * Returns `null` for a zero launch velocity, where `θ` is not defined at all
 * (`atan2(0, 0)` is 0 by fiat, which would be a fabricated elevation) and the
 * shot has no range to differentiate.
 */
export function scenarioAim(spec: ScenarioSpec): Aim | null {
  const { vx0, vy0 } = spec.initialConditions;
  const speed = Math.hypot(vx0, vy0);
  if (!(speed > 0)) return null;
  return { theta: Math.atan2(vy0, vx0), speed };
}

/**
 * The constant `C_d` this scenario's drag model exposes as a differentiable
 * parameter, or `null` when it has none.
 *
 * Two distinct ways to have none, and the panel reports them separately:
 * a `tabulated-reynolds` drag model has no scalar `C_d` to displace (its
 * coefficient is a function of the state, so "per unit of `C_d`" names
 * nothing), and a scenario with no quadratic-drag force wired reads the
 * coefficient nowhere.
 */
export function constantDragCoefficient(spec: ScenarioSpec): number | null {
  return spec.projectile.dragModel.kind === "constant" ? spec.projectile.dragModel.cd : null;
}

/** Whether any wired force actually reads `params.dragCoefficient` (`QuadraticDragForce` alone does). */
export function readsDragCoefficient(spec: ScenarioSpec): boolean {
  return spec.model.forceIds.includes("drag-quadratic");
}

/**
 * `EvalContext` for this scenario with the constant drag coefficient replaced
 * by `cd` — the `displaceContext` half of a {@link TangentParameter}.
 *
 * Rebuilt from the spec rather than patched onto `resolveModel`'s context
 * because `createEvalContext` closes over the params object it is handed;
 * mutating a live context would displace the base solve too.
 */
function contextWithDragCoefficient(spec: ScenarioSpec, cd: number): EvalContext {
  return createEvalContext(
    environmentSpecToEnvironment(spec.environment, spec.seed),
    projectileSpecToParams(
      { ...spec.projectile, dragModel: { kind: "constant", cd } },
      spec.initialConditions.spin0,
    ),
  );
}

/**
 * The `C_d` parameter, or `null` when this scenario has no differentiable one.
 *
 * `scale` is the coefficient's own magnitude so the central difference of
 * `∂f/∂C_d` is taken at a step proportional to it, which matters for the
 * small-`C_d` end (a drag coefficient of 0.02 differenced at a step sized for
 * 1.0 would be a 30% displacement).
 */
export function dragCoefficientParameter(spec: ScenarioSpec): TangentParameter | null {
  const cd = constantDragCoefficient(spec);
  if (cd === null || !readsDragCoefficient(spec)) return null;
  return {
    name: "cd",
    displaceContext: (delta) => contextWithDragCoefficient(spec, cd + delta),
    scale: cd,
  };
}

/**
 * The shooting problem the sensitivity solve runs, built from the committed
 * scenario.
 *
 * **The stepper is always Dormand–Prince 5(4), whatever the scenario picked,
 * and that is deliberate.** `createTangentLinearFlight` requires dense output
 * — without an interpolant the event cannot be localized, and the impact row
 * would be the last grid point *before* the ground crossing, making both the
 * state and its sensitivity values read off a point that is not on the event
 * surface. Half the steppers a scenario may select (`explicit-euler`,
 * `classical-rk4`, …) expose no interpolant, so honouring the scenario's
 * choice would blank these readouts for exactly the scenarios a learner
 * reaches for while studying step-size error. The readouts therefore describe
 * the *dynamics* the scenario specifies, integrated accurately; the canvas
 * shows what the scenario's own stepper makes of them. {@link
 * SensitivityReadout.stepperNote} says so on screen whenever the two differ.
 *
 * Tolerances and step budget do come from the scenario, so tightening
 * `rtol` tightens the readouts too.
 *
 * `target` is required by {@link ShootingProblem} and unread here —
 * `createTangentLinearFlight` documents that it touches only the dynamics and
 * the integration setup, never the target.
 */
export function sensitivityProblem(spec: ScenarioSpec): ShootingProblem {
  const { model, ctx } = resolveModel(spec);
  const config = resolveSolverConfig(spec);
  return {
    model,
    ctx,
    target: { kind: "point", center: [0, 0] },
    launchPoint: [spec.initialConditions.x0, spec.initialConditions.y0],
    config: { ...config, stepper: "dopri5" },
    stepper: createDormandPrince54Stepper(),
    layout: PLANAR_LAYOUT,
  };
}

/**
 * Model kinds this panel can speak for. `"planar"` and `"planar-spin"` both
 * lay their state out as `[x, y, vx, vy, …]`, so `PLANAR_LAYOUT` names the
 * right channels for each. `"spatial"` is excluded rather than approximated:
 * an aim in 3D carries an azimuth as well as an elevation, and reporting only
 * `dR/dθ` for it would silently answer a different question than the one the
 * row label asks.
 */
const SUPPORTED_MODEL_KINDS: readonly string[] = ["planar", "planar-spin"];

function unavailable(reason: string): SensitivityReadout {
  return {
    channels: SENSITIVITY_CHANNELS.map((channel) => ({
      id: channel.id,
      status: "unavailable" as const,
      reason,
    })),
    aim: null,
    timeOfFlight: null,
    failure: reason,
    stepperNote: null,
  };
}

/** Human note when the scenario's stepper is not the one the sensitivity solve used. */
function stepperNoteFor(spec: ScenarioSpec): string | null {
  const id = spec.solver.stepper;
  if (id === "dopri5" || id === "rk45") return null;
  return (
    `Computed with dopri5 (dense output required to localize the impact), not the scenario's ` +
    `"${id}". These are the exact dynamics' sensitivities, not the displayed trajectory's.`
  );
}

/**
 * The panel's whole state for one committed scenario: one tangent-linear solve
 * with `θ`, `v₀` and — when the scenario has one — `C_d` as parameters.
 *
 * All three channels ride a single augmented solve rather than one solve each.
 * That is not only cheaper; it is the only way they are guaranteed mutually
 * consistent, since a second solve would have its own step sequence.
 *
 * Never throws for scenario-shaped reasons: an unsupported model kind, a
 * degenerate aim and a shot that never lands all come back as a `failure`
 * string, because this runs on every commit and a throw here would take the
 * app down with it.
 */
export function computeSensitivityReadout(spec: ScenarioSpec): SensitivityReadout {
  const kind = spec.model.kind ?? "planar";
  if (!SUPPORTED_MODEL_KINDS.includes(kind)) {
    return unavailable(
      `Sensitivities are defined here for planar aims; this scenario's model is "${kind}", ` +
        `whose aim carries an azimuth as well as an elevation.`,
    );
  }

  const aim = scenarioAim(spec);
  if (aim === null) {
    return unavailable("Launch velocity is zero, so there is no elevation to differentiate.");
  }

  const cdParameter = dragCoefficientParameter(spec);
  const parameters: TangentParameter[] = [...aimParameters(PLANAR_LAYOUT)];
  if (cdParameter) parameters.push(cdParameter);

  const flight = createTangentLinearFlight(sensitivityProblem(spec), parameters)(aim);
  const sensitivities = rangeSensitivity(flight, PLANAR_LAYOUT);
  if (!flight.ok || sensitivities === null) {
    return {
      ...unavailable(flight.failure ?? "The sensitivity solve did not reach the ground."),
      aim,
    };
  }

  const byName = new Map(flight.parameters.map((name, index) => [name, sensitivities[index]!]));
  const channels = SENSITIVITY_CHANNELS.map((channel): ChannelReadout => {
    const value = byName.get(channel.id);
    if (value !== undefined) return { id: channel.id, status: "ok", value };
    return { id: channel.id, status: "unavailable", reason: dragUnavailableReason(spec) };
  });

  return {
    channels,
    aim,
    timeOfFlight: flight.timeOfFlight,
    failure: null,
    stepperNote: stepperNoteFor(spec),
  };
}

/**
 * Why the `C_d` row has no number. Separated from the "no drag force" case on
 * purpose: a scenario with `drag-quadratic` switched off has a `dR/dC_d` that
 * is *structurally* zero — `∂f/∂C_d` vanishes because nothing reads the
 * coefficient — and printing `0.00 m` for it would read as physics ("drag
 * doesn't matter here") when it is really an artefact of the force list. This
 * is the trap `tangent-linear.test.ts` documents at the fixture level, surfaced
 * at the UI level.
 */
function dragUnavailableReason(spec: ScenarioSpec): string {
  if (!readsDragCoefficient(spec)) {
    return "No quadratic-drag force is wired, so nothing reads C_d.";
  }
  return "This projectile's drag model is tabulated against Reynolds number, so it has no single C_d.";
}

/**
 * Row text for a readout: three significant figures with the channel's unit.
 *
 * `toPrecision(3)` matches `forces-panel.tsx`'s badge, and the em dash matches
 * its "no value yet" case, so the two panels read as one instrument.
 */
export function formatSensitivity(readout: ChannelReadout, channel: SensitivityChannel): string {
  if (readout.status !== "ok") return "—";
  return `${readout.value.toPrecision(3)} ${channel.unit}`;
}
