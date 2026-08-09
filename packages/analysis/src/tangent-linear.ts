import type { EvalContext, EventSpec, Model } from "@ballista/engine";
import {
  type SolveReport,
  type Trajectory,
  TrajectoryRecorder,
  integrate,
} from "@ballista/solverkit";
import { PLANAR_LAYOUT, type TrajectoryLayout } from "./observables.js";
import type { Aim, ShootingProblem } from "./shooting-residual.js";

/**
 * Tangent-linear (variational) integration of §7 Phase 5 (P5.10): carry
 * $S = \partial y/\partial\mu$ alongside the state instead of recovering it by
 * differencing whole solves.
 *
 * Differentiating $\dot y = f(t, y; \mu)$ with respect to a parameter $\mu_k$
 * and exchanging the derivatives gives the **variational equation**
 *
 * $$\dot S_k = \frac{\partial f}{\partial y}\,S_k + \frac{\partial f}{\partial \mu_k},
 * \qquad S_k(0) = \frac{\partial y_0}{\partial \mu_k},$$
 *
 * a linear ODE driven by the base trajectory. Stacking it under the state
 * gives one augmented system of dimension `n(1+m)` that the ordinary solver
 * integrates with no special support: the sensitivities inherit the stepper's
 * order and the controller's error estimate, and there is no differencing step
 * to amplify anything.
 *
 * **Why this exists when {@link shootingJacobian} already differences.**
 * `shooting-jacobian.ts` documents at length that a finite difference of an
 * *adaptive* solve carries a noise floor set by the integration tolerance
 * rather than by machine epsilon, because two nearby aims get two different
 * step sequences whose truncation errors do not cancel. The variational
 * approach has no such floor — it differentiates the ODE, not the solver — and
 * that is the entire reason this task exists downstream of that one. What it
 * costs is a Jacobian $\partial f/\partial y$ per right-hand-side evaluation.
 *
 * ## The event-time correction, which is most of the difficulty
 *
 * `S(T)` is $\partial y/\partial\mu$ **at fixed time**. Almost nothing anyone
 * wants from this module is at fixed time. Range, impact speed, flight time —
 * every impact observable is evaluated at $T(\mu)$, the moment the terminal
 * event fires, and that moment *moves* when $\mu$ moves. The total derivative
 * is
 *
 * $$\frac{\mathrm d}{\mathrm d\mu_k}\,y\bigl(T(\mu)\bigr)
 *   = S_k(T) + f\bigl(T, y(T)\bigr)\,\frac{\mathrm dT}{\mathrm d\mu_k},
 * \qquad
 * \frac{\mathrm dT}{\mathrm d\mu_k}
 *   = -\frac{\nabla g \cdot S_k(T)}{\nabla g \cdot f},$$
 *
 * the second identity obtained by differentiating the event condition
 * $g\bigl(y(T(\mu))\bigr) = 0$.
 *
 * Skipping the correction is not a small error. For a ground-impact event
 * $g = y$, the raw `S(T)` row for the *vertical* position is exactly what the
 * correction annihilates — vertical position at impact is pinned to the ground
 * for every $\mu$, so its total derivative is zero while `S(T)` is not — and
 * the horizontal row, the one that *is* range sensitivity, is off by
 * $v_x\,\mathrm dT/\mathrm d\mu$, which is the dominant term. Measured in
 * `tangent-linear.test.ts`: on the drag-free 45° shot the true
 * $\partial R/\partial\theta$ is zero while the uncorrected one is
 * **−163 m/rad**, so the correction is the whole answer rather than a
 * refinement to it; below the optimum the two carry **opposite signs**, since
 * raising the elevation lengthens the shot but at fixed time moves the
 * projectile backwards. Both numbers are returned separately
 * ({@link TangentLinearFlight.stateSensitivity} and
 * {@link TangentLinearFlight.impactSensitivity}) rather than one being folded
 * into the other, because they answer different questions and the raw one is
 * the one a fixed-time consumer wants.
 *
 * ## What is out of scope, stated rather than silently mishandled
 *
 * - **Terminal events with an `action`** (P4.11's restitution bounce) are
 *   rejected at construction. A reset map $y^+ = R(y^-)$ needs its own jump
 *   condition on $S$ — $S^+ = R'(y^-)S^- + (f^+ - R'f^-)\,\mathrm dT/\mathrm
 *   d\mu$ — and guessing it silently would produce sensitivities that look
 *   ordinary and are wrong after the first bounce.
 * - **Non-smooth parameter dependence.** A drag table with a corner
 *   ({@link ../../engine/src/pchip.ts} is smooth, a lookup with a kink is not)
 *   makes $\partial f/\partial\mu$ undefined at the kink; the validation
 *   criterion for this task says "smooth scenario" for that reason.
 * - **Grazing impacts.** When $\nabla g\cdot f \to 0$ the event is tangent to
 *   the flow and $\mathrm dT/\mathrm d\mu$ genuinely blows up. That is reported
 *   as a failure with the offending value, not returned as a large number.
 */

/**
 * One parameter to differentiate with respect to.
 *
 * A parameter can enter the problem in either of two places, and the two are
 * separate fields because they contribute to different terms of the
 * variational equation:
 *
 * - through the **launch state** (elevation, speed, launch height) — it seeds
 *   `S_k(0)` and contributes nothing to the driving term;
 * - through the **dynamics** (a drag coefficient, air density, gravity) — it
 *   drives $\partial f/\partial\mu_k$ and starts from `S_k(0) = 0`.
 *
 * A parameter may do both; one that does neither is rejected, since its
 * sensitivity is identically zero and asking for it is a mistake worth
 * surfacing rather than a column of zeros worth returning.
 */
export interface TangentParameter {
  /** Identifier, echoed back on the result so columns can be read by name. */
  readonly name: string;
  /**
   * Writes $\partial y_0/\partial\mu_k$ into `out` (length `model.dim`, zeroed
   * before the call). Omit when the parameter does not enter the launch state.
   */
  seedInitialState?(aim: Aim, out: Float64Array): void;
  /**
   * Returns an {@link EvalContext} with this parameter displaced by `delta`,
   * used to form $\partial f/\partial\mu_k$ by central difference. Omit when
   * the parameter does not enter the dynamics.
   *
   * **This is differenced, not differentiated analytically**, and unlike the
   * finite difference this module exists to replace, that is sound: `f` is an
   * algebraic function evaluated pointwise, with no adaptive controller
   * underneath it and therefore no tolerance-sized noise floor. Its accuracy is
   * the ordinary `ε^{2/3}` of a central difference, ~1e-11 relative, which is
   * far below the 1e-6 this task is validated to.
   */
  displaceContext?(delta: number): EvalContext;
  /**
   * Typical magnitude of $\mu_k$, scaling the $\partial f/\partial\mu_k$
   * difference step. Defaults to 1. Only read when {@link displaceContext} is
   * present.
   */
  readonly scale?: number;
}

/** Result of one tangent-linear solve. */
export interface TangentLinearFlight {
  /** Whether the solve reached its terminal event and every sensitivity is defined. */
  readonly ok: boolean;
  /** Why {@link ok} is false. Absent when it is true. */
  readonly failure?: string;
  /** The full solve report of the augmented system. */
  readonly report: SolveReport;
  /** The aim flown, echoed back. */
  readonly aim: Aim;
  /** Parameter names in the order the sensitivity rows use. */
  readonly parameters: readonly string[];
  /** Time the terminal event fired, seconds. `null` when {@link ok} is false. */
  readonly timeOfFlight: number | null;
  /** The base state at impact, length `model.dim`. `null` when {@link ok} is false. */
  readonly state: number[] | null;
  /**
   * $S_k(T)$ — the **fixed-time** sensitivity, `stateSensitivity[k][i] =
   * \partial y_i/\partial\mu_k` holding `t = T` constant. `null` when
   * {@link ok} is false.
   *
   * This is the raw output of the variational equation. For an impact
   * observable it is *not* the derivative you want; see
   * {@link impactSensitivity} and this module's header.
   */
  readonly stateSensitivity: number[][] | null;
  /** $\mathrm dT/\mathrm d\mu_k$, seconds per parameter unit. `null` when {@link ok} is false. */
  readonly timeSensitivity: number[] | null;
  /**
   * $\mathrm d\,y_i(T(\mu))/\mathrm d\mu_k$ — the **total** derivative of the
   * impact state, event-time correction included. `null` when {@link ok} is
   * false. This is what range and impact-speed sensitivities are read from.
   */
  readonly impactSensitivity: number[][] | null;
  /**
   * The augmented trajectory: channels `0..n-1` are the state, then `m` blocks
   * of `n` holding `S_1 … S_m`. `null` when {@link ok} is false. Kept because
   * P5.11's live readouts want the sensitivity history, not only its endpoint.
   */
  readonly trajectory: Trajectory | null;
}

/** A tangent-linear flight function of the aim, with the problem closed over. */
export type TangentLinearFlightFunction = (aim: Aim) => TangentLinearFlight;

const DEFAULT_TSPAN: readonly [number, number] = [0, 600];

/**
 * Relative step for the central differences this module takes — of `f` with
 * respect to `y` (when the model has no analytic Jacobian) and of `f` with
 * respect to `μ`.
 *
 * `ε^{1/3}` is the optimum for a central difference of a function corrupted
 * only at the machine-epsilon level, which `f` is: it is an algebraic
 * evaluation, not a solve. This is the same reasoning `shooting-jacobian.ts`
 * spells out, applied where its pessimistic case does not arise.
 */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

/** Central-difference step for perturbing a quantity of magnitude `scale`. */
function differenceStep(scale: number): number {
  return CBRT_EPS * Math.max(Math.abs(scale), 1);
}

/**
 * `∂y₀/∂θ` for {@link ShootingProblem}'s launch convention: only the velocity
 * moves, and it rotates.
 *
 * Written here rather than differenced because it is exact and because
 * duplicating the launch convention is precisely the hazard `createFlight`'s
 * doc comment warns about — see {@link aimParameters}, which is the only thing
 * that should build these.
 */
function seedTheta(aim: Aim, layout: TrajectoryLayout, out: Float64Array): void {
  const downrange = layout.vertical === 0 ? 1 : 0;
  out[layout.velocity[downrange]!] = -aim.speed * Math.sin(aim.theta);
  out[layout.velocity[layout.vertical]!] = aim.speed * Math.cos(aim.theta);
}

/** `∂y₀/∂v₀`: the unit vector along the launch direction. */
function seedSpeed(aim: Aim, layout: TrajectoryLayout, out: Float64Array): void {
  const downrange = layout.vertical === 0 ? 1 : 0;
  out[layout.velocity[downrange]!] = Math.cos(aim.theta);
  out[layout.velocity[layout.vertical]!] = Math.sin(aim.theta);
}

/**
 * The two aim parameters, `θ` then `v₀`, in {@link AIM_COLUMNS} order.
 *
 * These are the columns P5.11's readouts want (`dRange/dθ`, `dRange/dv₀`) and
 * the ones P5.05's finite-difference Jacobian approximates, so they are
 * supplied rather than left to every caller to re-derive: getting
 * `∂y₀/∂θ = (0, 0, −v₀ sinθ, v₀ cosθ)` subtly wrong — a swapped sign, a missing
 * `v₀` — produces a sensitivity that is smooth, plausible and off by a factor,
 * which is the failure mode this whole module is supposed to eliminate.
 *
 * @param layout Channel layout of the model's state. Must be the layout the
 *   problem is solved with; a mismatch seeds the wrong channels.
 */
export function aimParameters(layout: TrajectoryLayout = PLANAR_LAYOUT): TangentParameter[] {
  return [
    { name: "theta", seedInitialState: (aim, out) => seedTheta(aim, layout, out) },
    { name: "speed", seedInitialState: (aim, out) => seedSpeed(aim, layout, out) },
  ];
}

/**
 * Central-difference `∂f/∂y` into `out` (row-major `n×n`), reusing the caller's
 * scratch buffers.
 *
 * This is `@ballista/engine`'s `finiteDifferenceJacobian` with the allocation
 * hoisted out. That function documents itself as *"not on the zero-allocation
 * hot path … allocates dim-sized scratch buffers per call"*, which is true of
 * its intended use as a Newton fallback and false of this one: here it runs
 * once per right-hand-side evaluation, so seven times per Dormand–Prince step
 * and tens of thousands of times per solve. The formula is deliberately
 * identical, and `tangent-linear.test.ts` asserts the two agree exactly on a
 * sample state so the copy cannot drift from the original.
 */
function jacobianInto(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  scratch: { yPerturbed: Float64Array; fPlus: Float64Array; fMinus: Float64Array },
): void {
  const dim = model.dim;
  const { yPerturbed, fPlus, fMinus } = scratch;
  yPerturbed.set(y);

  for (let j = 0; j < dim; j++) {
    const yj = y[j]!;
    const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(yj), 1);

    yPerturbed[j] = yj + h;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = yj - h;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = yj;

    const inv2h = 1 / (2 * h);
    for (let i = 0; i < dim; i++) out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
  }
}

/**
 * Builds the augmented model whose state is `[y, S_1, …, S_m]`.
 *
 * Exported for the tests, which check the variational block against a
 * hand-written linear system, and for anyone who wants to attach their own
 * sinks to the augmented solve. Ordinary callers want
 * {@link createTangentLinearFlight}.
 */
export function createTangentLinearModel(
  model: Model,
  parameters: readonly TangentParameter[],
): Model {
  const n = model.dim;
  const m = parameters.length;
  const dim = n * (1 + m);

  const jac = new Float64Array(n * n);
  const yScratch = new Float64Array(n);
  const fScratch = new Float64Array(n);
  const fPlus = new Float64Array(n);
  const fMinus = new Float64Array(n);
  const jacScratch = {
    yPerturbed: new Float64Array(n),
    fPlus: new Float64Array(n),
    fMinus: new Float64Array(n),
  };
  const displaced = parameters.map((parameter) => {
    if (parameter.displaceContext === undefined) return null;
    const step = differenceStep(parameter.scale ?? 1);
    return {
      step,
      plus: parameter.displaceContext(step),
      minus: parameter.displaceContext(-step),
    };
  });

  const channels = [
    ...model.channels,
    ...parameters.flatMap((parameter) =>
      model.channels.map((channel) => ({
        name: `d(${channel.name})/d(${parameter.name})`,
        unit: `${channel.unit}/[${parameter.name}]`,
      })),
    ),
  ];

  // Events read only the base block. `g` is handed the augmented array, so the
  // base state is copied into a scratch buffer of the model's own dimension
  // rather than passed through — an event that reads `y.length` (a norm over
  // "the state") would otherwise sweep in the sensitivity channels.
  const events: EventSpec[] | undefined = model.events?.map((event) => ({
    name: event.name,
    ...(event.direction !== undefined ? { direction: event.direction } : {}),
    ...(event.terminal !== undefined ? { terminal: event.terminal } : {}),
    g(t: number, Y: Float64Array): number {
      for (let i = 0; i < n; i++) yScratch[i] = Y[i]!;
      return event.g(t, yScratch);
    },
  }));

  return {
    dim,
    channels,
    ...(events !== undefined ? { events } : {}),
    rhs(t: number, Y: Float64Array, out: Float64Array, ctx: EvalContext): void {
      for (let i = 0; i < n; i++) yScratch[i] = Y[i]!;

      model.rhs(t, yScratch, fScratch, ctx);
      for (let i = 0; i < n; i++) out[i] = fScratch[i]!;

      if (model.jacobian !== undefined) model.jacobian(t, yScratch, ctx, jac);
      else jacobianInto(model, t, yScratch, ctx, jac, jacScratch);

      for (let k = 0; k < m; k++) {
        const base = n * (1 + k);
        const perturbation = displaced[k]!;

        if (perturbation === null) {
          for (let i = 0; i < n; i++) out[base + i] = 0;
        } else {
          model.rhs(t, yScratch, fPlus, perturbation.plus);
          model.rhs(t, yScratch, fMinus, perturbation.minus);
          const inv2h = 1 / (2 * perturbation.step);
          for (let i = 0; i < n; i++) out[base + i] = (fPlus[i]! - fMinus[i]!) * inv2h;
        }

        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let j = 0; j < n; j++) sum += jac[i * n + j]! * Y[base + j]!;
          out[base + i] = out[base + i]! + sum;
        }
      }
    },
  };
}

/** Reads the terminal event a problem's model declares, rejecting the cases this module cannot carry. */
function terminalEventOf(model: Model): EventSpec {
  const terminal = (model.events ?? []).filter((event) => event.terminal);
  if (terminal.length === 0) {
    throw new Error(
      "createTangentLinearFlight: the model declares no terminal event, so there is no " +
        "impact time to differentiate and every impact sensitivity would be read off " +
        "whatever row `tspan` happened to end on",
    );
  }
  if (terminal.length > 1) {
    throw new Error(
      `createTangentLinearFlight: the model declares ${terminal.length} terminal events ` +
        "(" +
        terminal.map((event) => event.name).join(", ") +
        "). The event-time correction differentiates the condition that actually fired, and " +
        "this module cannot tell which one that was from the solve report",
    );
  }
  const event = terminal[0]!;
  if (event.action !== undefined) {
    throw new Error(
      `createTangentLinearFlight: terminal event "${event.name}" declares an action ` +
        "(a reset map, e.g. P4.11's restitution bounce). The sensitivity needs its own jump " +
        "condition across the reset, S+ = R'(y-) S- + (f+ - R' f-) dT/dmu, which this module " +
        "does not apply — carrying S straight through would be wrong from the first bounce on " +
        "and would look entirely ordinary",
    );
  }
  return event;
}

/**
 * Closes a {@link ShootingProblem} over its fixed parts and returns the
 * tangent-linear solve as a function of the aim.
 *
 * The stepper, config, tspan, launch point and layout all come from the same
 * {@link ShootingProblem} the residual and the envelope use, so a sensitivity
 * and the residual it differentiates cannot disagree about the setup.
 *
 * **The augmented solve is not the base solve.** Its error controller sees the
 * sensitivity channels too — entries of order 100 m/rad next to positions of
 * order 10 m — so it chooses a different step sequence, and the base state it
 * returns differs from a plain `createFlight` at the tolerance level. That is
 * the correct behaviour (the sensitivities are controlled to the same tolerance
 * as the state, which is the point of integrating them together) but it means
 * `flight.state` is not bit-identical to `createFlight`'s, and a test comparing
 * them needs a tolerance rather than an equality.
 *
 * @param problem The shooting problem; only its dynamics and integration setup
 *   are read, never its target.
 * @param parameters What to differentiate with respect to. Pass
 *   {@link aimParameters} for the `(θ, v₀)` pair.
 */
export function createTangentLinearFlight(
  problem: ShootingProblem,
  parameters: readonly TangentParameter[],
): TangentLinearFlightFunction {
  if (parameters.length === 0) {
    throw new Error("createTangentLinearFlight: no parameters to differentiate with respect to");
  }
  for (const parameter of parameters) {
    if (parameter.seedInitialState === undefined && parameter.displaceContext === undefined) {
      throw new Error(
        `createTangentLinearFlight: parameter "${parameter.name}" enters neither the launch ` +
          "state nor the dynamics, so its sensitivity is identically zero. Give it a " +
          "seedInitialState or a displaceContext",
      );
    }
  }
  if (problem.stepper.interpolant === undefined) {
    throw new Error(
      `createTangentLinearFlight: stepper "${problem.stepper.info.id}" exposes no dense-output ` +
        "interpolant, so `integrate` cannot truncate the step at the event root. The impact " +
        "row would be the last grid point before the crossing, and both the state and its " +
        "sensitivity would be read off a point that is not on the event surface",
    );
  }

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const event = terminalEventOf(problem.model);
  const augmented = createTangentLinearModel(problem.model, parameters);
  const tspan = problem.tspan ?? DEFAULT_TSPAN;
  const n = problem.model.dim;
  const m = parameters.length;
  const names = parameters.map((parameter) => parameter.name);

  return (aim: Aim): TangentLinearFlight => {
    if (!Number.isFinite(aim.theta) || !Number.isFinite(aim.speed)) {
      throw new Error(
        `createTangentLinearFlight: aim must be finite; got θ = ${aim.theta}, v₀ = ${aim.speed}`,
      );
    }

    const Y0 = new Float64Array(augmented.dim);
    const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
    if (launchPoint.length !== layout.position.length) {
      throw new Error(
        `createTangentLinearFlight: launchPoint has ${launchPoint.length} component(s), ` +
          `but the layout has ${layout.position.length} position axis/axes`,
      );
    }
    for (let axis = 0; axis < layout.position.length; axis++) {
      Y0[layout.position[axis]!] = launchPoint[axis]!;
    }
    const downrange = layout.vertical === 0 ? 1 : 0;
    Y0[layout.velocity[downrange]!] = aim.speed * Math.cos(aim.theta);
    Y0[layout.velocity[layout.vertical]!] = aim.speed * Math.sin(aim.theta);

    for (let k = 0; k < m; k++) {
      const seed = parameters[k]!.seedInitialState;
      if (seed === undefined) continue;
      const block = new Float64Array(n);
      seed(aim, block);
      Y0.set(block, n * (1 + k));
    }

    const recorder = new TrajectoryRecorder();
    const report = integrate(augmented, problem.ctx, Y0, tspan, problem.config, problem.stepper, [
      recorder,
    ]);

    const endedOnEvent = report.tFinal < tspan[1];
    if (report.status !== "ok" || !endedOnEvent || recorder.trajectory.nSteps < 1) {
      return {
        ok: false,
        failure:
          report.status !== "ok"
            ? `the augmented solve did not finish (status "${report.status}")`
            : "the solve ran to the end of tspan without reaching its terminal event, so there " +
              "is no impact time to differentiate",
        report,
        aim,
        parameters: names,
        timeOfFlight: null,
        state: null,
        stateSensitivity: null,
        timeSensitivity: null,
        impactSensitivity: null,
        trajectory: null,
      };
    }

    const trajectory = recorder.trajectory;
    const row = trajectory.nSteps - 1;
    const T = trajectory.t[row]!;

    const state = new Float64Array(n);
    for (let i = 0; i < n; i++) state[i] = trajectory.channels[i]![row]!;

    const sensitivity: number[][] = [];
    for (let k = 0; k < m; k++) {
      const block: number[] = [];
      for (let i = 0; i < n; i++) block.push(trajectory.channels[n * (1 + k) + i]![row]!);
      sensitivity.push(block);
    }

    // ∇g at the impact state, by the same central difference the Jacobian uses.
    // `g` is a scalar of `y` alone, so this is n cheap evaluations of an
    // algebraic function — not of a solve.
    const gradient = new Float64Array(n);
    const probe = Float64Array.from(state);
    for (let i = 0; i < n; i++) {
      const value = state[i]!;
      const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(value), 1);
      probe[i] = value + h;
      const plus = event.g(T, probe);
      probe[i] = value - h;
      const minus = event.g(T, probe);
      probe[i] = value;
      gradient[i] = (plus - minus) / (2 * h);
    }

    const f = new Float64Array(n);
    problem.model.rhs(T, state, f, problem.ctx);

    let gDot = 0;
    for (let i = 0; i < n; i++) gDot += gradient[i]! * f[i]!;

    // A grazing impact is the genuine singularity of the correction, not a
    // numerical wobble: the flow is tangent to the event surface, the crossing
    // time is not a differentiable function of the parameter, and dT/dμ is
    // unbounded. Reporting the value is the useful part — "the event is tangent
    // to within 3e-14" tells a caller to move the target off the boundary,
    // where "sensitivity failed" does not.
    const scale = Math.hypot(...gradient) * Math.hypot(...f);
    if (!Number.isFinite(gDot) || Math.abs(gDot) <= 1e-10 * Math.max(scale, 1)) {
      return {
        ok: false,
        failure:
          `the terminal event "${event.name}" is grazing at impact: d g/d t = ${gDot} against ` +
          `a scale of ${scale}, so the impact time is not differentiable in the parameters and ` +
          "the event-time correction is unbounded",
        report,
        aim,
        parameters: names,
        timeOfFlight: T,
        state: Array.from(state),
        stateSensitivity: sensitivity,
        timeSensitivity: null,
        impactSensitivity: null,
        trajectory,
      };
    }

    const timeSensitivity: number[] = [];
    const impactSensitivity: number[][] = [];
    for (let k = 0; k < m; k++) {
      let gS = 0;
      for (let i = 0; i < n; i++) gS += gradient[i]! * sensitivity[k]![i]!;
      const dT = -gS / gDot;
      timeSensitivity.push(dT);
      impactSensitivity.push(sensitivity[k]!.map((value, i) => value + f[i]! * dT));
    }

    return {
      ok: true,
      report,
      aim,
      parameters: names,
      timeOfFlight: T,
      state: Array.from(state),
      stateSensitivity: sensitivity,
      timeSensitivity,
      impactSensitivity,
      trajectory,
    };
  };
}

/**
 * `∂R/∂μ_k` for every parameter: the sensitivity of **downrange distance at
 * impact**, which is what P5.11's readouts show.
 *
 * Reads {@link TangentLinearFlight.impactSensitivity}, i.e. the event-corrected
 * derivative — the uncorrected one answers "how does the horizontal position at
 * this fixed instant move", which is a different and much less useful quantity.
 *
 * @returns One value per parameter, in the flight's parameter order, or `null`
 *   when the flight failed.
 */
export function rangeSensitivity(
  flight: TangentLinearFlight,
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): number[] | null {
  if (!flight.ok || flight.impactSensitivity === null) return null;
  const downrange = layout.vertical === 0 ? 1 : 0;
  const channel = layout.position[downrange]!;
  return flight.impactSensitivity.map((block) => {
    const value = block[channel];
    if (value === undefined) {
      throw new Error(
        `rangeSensitivity: the layout names position channel ${channel}, but the sensitivity ` +
          `block has only ${block.length} component(s)`,
      );
    }
    return value;
  });
}
