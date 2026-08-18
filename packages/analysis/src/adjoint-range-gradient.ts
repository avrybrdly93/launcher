import type { ChannelMeta, EvalContext, EventSpec, Model } from "@ballista/engine";
import { type SolveReport, type SolverConfig, integrate } from "@ballista/solverkit";
import { PLANAR_LAYOUT, downrangeAxisOf } from "./observables.js";
import { type Aim, type ShootingProblem, createFlight } from "./shooting-residual.js";
import type { TangentParameter } from "./tangent-linear.js";

/**
 * Adjoint (backward) gradient of **downrange distance at impact**, P5.24's
 * prototype for blueprint §9.2's scaling story:
 *
 * > A short adjoint prototype (P5.24) documents the many-parameter scaling
 * > story ($\mathcal O(1)$ backward solves vs $\mathcal O(n_\mu)$ tangent
 * > solves) without committing the platform to full adjoint infrastructure.
 *
 * The full derivation, the honest accounting of what "$\mathcal O(1)$" does
 * and does not mean here, and the discrete-vs-continuous question are in
 * `docs/notes/adjoint-sensitivity.md`. What follows is the summary a reader
 * of this file needs.
 *
 * ## The identity
 *
 * The tangent-linear module ({@link ./tangent-linear.js}) carries
 * $S_k = \partial y/\partial\mu_k$ forward, one $n$-vector per parameter,
 * obeying
 *
 * $$\dot S_k = A(t)\,S_k + b_k(t), \qquad A = \frac{\partial f}{\partial y},
 *   \qquad b_k = \frac{\partial f}{\partial \mu_k}.$$
 *
 * Range at impact is $R = e_R\!\cdot y(T(\mu))$ with the impact time $T$ fixed
 * by the terminal event $g(y(T)) = 0$, so — this is the same event-time
 * correction `tangent-linear.ts` derives —
 *
 * $$\frac{\mathrm dR}{\mathrm d\mu_k}
 *   = \Bigl[\,e_R - \frac{e_R\!\cdot f}{\nabla g\cdot f}\,\nabla g\,\Bigr]
 *     \cdot S_k(T)
 *   \;\equiv\; \lambda(T)^{\mathsf T} S_k(T).$$
 *
 * Now let $\lambda$ solve the **adjoint equation** backwards from that
 * terminal value:
 *
 * $$\dot\lambda = -A(t)^{\mathsf T}\lambda, \qquad \lambda(T) \text{ as above}.$$
 *
 * Then $\frac{\mathrm d}{\mathrm dt}(\lambda^{\mathsf T}S_k)
 * = -\lambda^{\mathsf T}A S_k + \lambda^{\mathsf T}(A S_k + b_k)
 * = \lambda^{\mathsf T}b_k$, and integrating from 0 to $T$ gives the whole
 * gradient without ever forming $S_k$:
 *
 * $$\boxed{\;\frac{\mathrm dR}{\mathrm d\mu_k}
 *   = \lambda(0)^{\mathsf T}\,S_k(0)
 *   + \int_0^T \lambda(t)^{\mathsf T} b_k(t)\,\mathrm dt\;}$$
 *
 * The two terms are exactly the two ways `TangentParameter` says a parameter
 * can enter the problem: $S_k(0)$ is `seedInitialState` (θ, v₀ — the launch
 * state), $b_k$ is `displaceContext` (C_d, ρ, g — the dynamics). A parameter
 * that does neither contributes nothing, which is why both modules reject it.
 *
 * ## The scaling claim, stated so it can be checked
 *
 * | | forward (tangent-linear) | backward (here) |
 * |---|---|---|
 * | augmented dimension | $n(1+m)$ | $2n + m$ |
 * | solves | 1 | 2 (one forward base, one backward) |
 * | growth in $m$ | $n$ per parameter | **1** per parameter |
 *
 * For the planar projectile ($n = 4$) at $m = 3$ that is 16 against 11 — no
 * win worth having. At $m = 30$ it is 124 against 38. The crossover is the
 * point of the exhibit, and it is *measured* rather than asserted:
 * {@link AdjointRangeGradient} reports both dimensions, and
 * `adjoint-range-gradient.test.ts` checks the arithmetic at three values of
 * $m$.
 *
 * The honest caveat, which the note expands on: this buys nothing for the
 * *shooting* solves the rest of Phase 5 runs. Those need $\partial(\text{2
 * residuals})/\partial(\text{2 aims})$ — two outputs, two parameters — where
 * an adjoint would need one backward solve *per output* and the forward
 * method needs one augmented solve for all of them. Adjoints win when
 * parameters outnumber outputs, and Phase 5's problems are the other shape.
 * Phase 6's sensitivity work (§9.4's tornado charts over many uncertain
 * inputs) is where this direction pays.
 *
 * ## Continuous adjoint, not discrete — said plainly
 *
 * The task title says "discrete-adjoint". **This is the continuous adjoint:**
 * it differentiates the ODE and then discretises the resulting adjoint ODE
 * ("differentiate-then-discretise"). A genuinely *discrete* adjoint
 * transposes the Runge–Kutta scheme itself
 * ("discretise-then-differentiate"), which needs the stepper's stage values
 * and its accepted step sequence, a transposed tableau, and a checkpointing
 * scheme — precisely the "full adjoint infrastructure" blueprint §9.2 says
 * this task must *not* commit the platform to.
 *
 * What the choice costs is stated rather than hidden: a discrete adjoint
 * returns the exact gradient *of the discrete solution*, so it agrees with a
 * discrete tangent-linear to machine precision. This one agrees only to
 * integration tolerance, because the two discretise different (equivalent)
 * continuous objects. That is why the validation criterion is 1e-8 and not
 * 1e-15, and why the test runs at `rtol = 1e-12`.
 */

/** Result of one adjoint gradient evaluation. */
export interface AdjointRangeGradient {
  /** Whether both solves finished and the gradient is defined. */
  readonly ok: boolean;
  /** Why not, when {@link ok} is false. */
  readonly failure?: string;
  /** Parameter names, in the order {@link gradient} uses. */
  readonly parameters: readonly string[];
  /** `dR/dμ_k`, one per parameter. `null` when {@link ok} is false. */
  readonly gradient: number[] | null;
  /** Impact time of the base solve. `null` when the base solve found no impact. */
  readonly timeOfFlight: number | null;
  /** Downrange distance at impact — the quantity being differentiated. */
  readonly range: number | null;
  /**
   * The terminal adjoint seed `λ(T)`, before any backward integration. Worth
   * reporting because it is where the event-time correction lives: for a
   * ground-impact event its vertical-position entry is `−v_x/v_y`, and a
   * reader checking this module against `tangent-linear.ts` compares here
   * first.
   */
  readonly terminalAdjoint: number[] | null;
  /**
   * `λ(0)` — the adjoint at launch, which is the sensitivity of range to a
   * perturbation of the *initial state*. Contracted with each parameter's
   * `seedInitialState` to give the launch-state half of the gradient.
   */
  readonly launchAdjoint: number[] | null;
  /**
   * `∫₀^T λᵀ b_k dt` per parameter — the dynamics half. Exactly zero for a
   * parameter with no `displaceContext`.
   */
  readonly quadrature: number[] | null;
  /**
   * How far the backward-integrated base state drifted from the true launch
   * state, in the max norm.
   *
   * This is the prototype's one real shortcut made measurable. A production
   * adjoint checkpoints the forward trajectory and interpolates it; this
   * re-integrates `ẏ = f` backwards from the impact state, which is simpler,
   * needs no interpolant, and is *not free*: reversing a dissipative system
   * makes it anti-dissipative, so the recovered `y(0)` drifts. Over a
   * projectile flight at a tight tolerance the drift is tiny, and reporting
   * it means a caller who tries this on a longer or stiffer problem sees the
   * shortcut fail loudly instead of getting a quietly wrong gradient.
   */
  readonly stateRoundTripError: number | null;
  /** `n(1+m)`, the augmented dimension the tangent-linear method would integrate. */
  readonly forwardDimension: number;
  /** `2n+m`, the augmented dimension this method integrates backwards. */
  readonly backwardDimension: number;
  /** The base (forward) solve's report. */
  readonly forwardReport: SolveReport;
  /** The backward solve's report; `null` when the base solve failed first. */
  readonly backwardReport: SolveReport | null;
}

/** `(aim) => AdjointRangeGradient`, the shape {@link createAdjointRangeGradient} returns. */
export type AdjointRangeGradientFunction = (aim: Aim) => AdjointRangeGradient;

/** Central-difference step for `∂f/∂μ`, matching `tangent-linear.ts` exactly. */
const CBRT_EPS = Math.cbrt(Number.EPSILON);

function differenceStep(scale: number): number {
  return CBRT_EPS * Math.max(Math.abs(scale), 1);
}

/**
 * Reads the single terminal event, rejecting the cases the adjoint cannot
 * carry. Deliberately the same three rejections `tangent-linear.ts` makes,
 * with the same reasons, because the event-time correction is the same
 * formula: a model one module can differentiate and the other cannot would be
 * a trap, and the two are compared against each other in tests.
 */
function terminalEventOf(model: Model): EventSpec {
  const terminal = (model.events ?? []).filter((event) => event.terminal);
  if (terminal.length === 0) {
    throw new Error(
      "createAdjointRangeGradient: the model declares no terminal event, so there is no " +
        "impact time to differentiate and the terminal adjoint λ(T) is undefined",
    );
  }
  if (terminal.length > 1) {
    throw new Error(
      `createAdjointRangeGradient: the model declares ${terminal.length} terminal events (` +
        terminal.map((event) => event.name).join(", ") +
        "). λ(T) differentiates the condition that actually fired, and this module cannot " +
        "tell which one that was from the solve report",
    );
  }
  const event = terminal[0]!;
  if (event.action !== undefined) {
    throw new Error(
      `createAdjointRangeGradient: terminal event "${event.name}" declares an action (a reset ` +
        "map, e.g. P4.11's restitution bounce). The adjoint needs its own jump condition " +
        "backwards across the reset — λ⁻ = R'(y⁻)ᵀλ⁺ plus an event-time term — which this " +
        "module does not apply, and carrying λ straight through would be wrong from the " +
        "first bounce on while looking entirely ordinary",
    );
  }
  return event;
}

/** `∇g` at a state, by the same central difference `tangent-linear.ts` uses. */
function eventGradientInto(
  event: EventSpec,
  t: number,
  state: Float64Array,
  probe: Float64Array,
  out: Float64Array,
): void {
  probe.set(state);
  for (let i = 0; i < state.length; i++) {
    const value = state[i]!;
    const h = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(value), 1);
    probe[i] = value + h;
    const plus = event.g(t, probe);
    probe[i] = value - h;
    const minus = event.g(t, probe);
    probe[i] = value;
    out[i] = (plus - minus) / (2 * h);
  }
}

/** `∂f/∂y` by central difference, byte-for-byte the formula `tangent-linear.ts` uses. */
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
 * Builds the backward model whose state is `[y, λ, I]`, integrated in the
 * reversed time `s = T − t` over `[0, T]`.
 *
 * Reversing the clock rather than asking `integrate` to run backwards is
 * deliberate: the driver, the controller and every stepper in `solverkit`
 * assume an increasing independent variable, and a module that quietly handed
 * them a decreasing one would be relying on behaviour nothing tests. The
 * substitution costs three sign flips, all of them here:
 *
 * ```
 *   dy/ds = −f(T−s, y)                 (the base trajectory, replayed)
 *   dλ/ds = +A(T−s, y)ᵀ λ              (the adjoint; λ̇ = −Aᵀλ in t)
 *   dI_k/ds = λ · b_k(T−s, y)          (the quadrature, so I_k(T) = ∫₀ᵀ λᵀb_k dt)
 * ```
 *
 * `T` is captured, so a model built here belongs to one flight and must not be
 * reused across aims.
 *
 * Exported for the tests, which check the adjoint block against a hand-written
 * `Aᵀλ` and check that the quadrature row of a launch-state-only parameter is
 * identically zero. Ordinary callers want {@link createAdjointRangeGradient}.
 */
export function createBackwardAdjointModel(
  model: Model,
  parameters: readonly TangentParameter[],
  impactTime: number,
): Model {
  const n = model.dim;
  const m = parameters.length;
  const dim = 2 * n + m;

  const jac = new Float64Array(n * n);
  const yScratch = new Float64Array(n);
  const fScratch = new Float64Array(n);
  const bScratch = new Float64Array(n);
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

  const channels: ChannelMeta[] = [
    ...model.channels.map((channel) => ({
      name: `${channel.name} (replayed)`,
      unit: channel.unit,
    })),
    ...model.channels.map((channel) => ({
      name: `lambda(${channel.name})`,
      unit: `m/[${channel.unit}]`,
    })),
    ...parameters.map((parameter) => ({
      name: `quadrature(${parameter.name})`,
      unit: `m/[${parameter.name}]`,
    })),
  ];

  // No events. The backward span is [0, T] with T already known, so there is
  // nothing to detect: adding the forward model's terminal event here would
  // fire immediately, at s = 0, where the state is on the event surface by
  // construction.
  return {
    dim,
    channels,
    rhs(s: number, Z: Float64Array, out: Float64Array, ctx: EvalContext): void {
      const t = impactTime - s;
      for (let i = 0; i < n; i++) yScratch[i] = Z[i]!;

      model.rhs(t, yScratch, fScratch, ctx);
      for (let i = 0; i < n; i++) out[i] = -fScratch[i]!;

      if (model.jacobian !== undefined) model.jacobian(t, yScratch, ctx, jac);
      else jacobianInto(model, t, yScratch, ctx, jac, jacScratch);

      // dλ/ds = +Aᵀλ. The transpose is the whole difference between this and
      // the variational block in tangent-linear.ts: there the row index of
      // `jac` runs over the output, here over the multiplier.
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += jac[j * n + i]! * Z[n + j]!;
        out[n + i] = sum;
      }

      for (let k = 0; k < m; k++) {
        const perturbation = displaced[k]!;
        if (perturbation === null) {
          // A launch-state-only parameter has ∂f/∂μ ≡ 0, so its quadrature is
          // identically zero and its whole gradient comes from λ(0)ᵀS_k(0).
          out[2 * n + k] = 0;
          continue;
        }
        model.rhs(t, yScratch, fPlus, perturbation.plus);
        model.rhs(t, yScratch, fMinus, perturbation.minus);
        const inv2h = 1 / (2 * perturbation.step);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          bScratch[i] = (fPlus[i]! - fMinus[i]!) * inv2h;
          sum += Z[n + i]! * bScratch[i]!;
        }
        out[2 * n + k] = sum;
      }
    },
  };
}

/**
 * Closes a {@link ShootingProblem} over its fixed parts and returns the
 * adjoint range gradient as a function of the aim.
 *
 * The same `problem` the residual, the envelope and the tangent-linear module
 * read, so a gradient and the trajectory it differentiates cannot disagree
 * about the setup. Only the dynamics and integration setup are used; the
 * target is never read, because range at impact is not a targeting question.
 *
 * @param problem The shooting problem supplying the model, context, launch
 *   point, stepper, config and layout.
 * @param parameters What to differentiate with respect to — the same
 *   {@link TangentParameter} values the tangent-linear module takes, so one
 *   list drives both methods and the comparison in the tests is genuinely of
 *   two implementations rather than of two problem statements.
 */
export function createAdjointRangeGradient(
  problem: ShootingProblem,
  parameters: readonly TangentParameter[],
): AdjointRangeGradientFunction {
  if (parameters.length === 0) {
    throw new Error("createAdjointRangeGradient: no parameters to differentiate with respect to");
  }
  for (const parameter of parameters) {
    if (parameter.seedInitialState === undefined && parameter.displaceContext === undefined) {
      throw new Error(
        `createAdjointRangeGradient: parameter "${parameter.name}" enters neither the launch ` +
          "state nor the dynamics, so both halves of dR/dμ vanish identically. Give it a " +
          "seedInitialState or a displaceContext",
      );
    }
  }

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const event = terminalEventOf(problem.model);
  const flightOf = createFlight(problem);

  const n = problem.model.dim;
  const m = parameters.length;
  const names = parameters.map((parameter) => parameter.name);
  const rangeChannel = layout.position[downrangeAxisOf(layout)]!;
  const forwardDimension = n * (1 + m);
  const backwardDimension = 2 * n + m;

  return (aim: Aim): AdjointRangeGradient => {
    const flight = flightOf(aim);
    const base = {
      parameters: names,
      forwardDimension,
      backwardDimension,
      forwardReport: flight.report,
    };
    if (!flight.ok || flight.trajectory === null) {
      return {
        ...base,
        ok: false,
        failure:
          "the base solve did not reach its terminal event, so there is no impact to " +
          `differentiate (status "${flight.report.status}")`,
        gradient: null,
        timeOfFlight: null,
        range: null,
        terminalAdjoint: null,
        launchAdjoint: null,
        quadrature: null,
        stateRoundTripError: null,
        backwardReport: null,
      };
    }

    const trajectory = flight.trajectory;
    const row = trajectory.nSteps - 1;
    const impactTime = trajectory.t[row]!;
    const impactState = new Float64Array(n);
    for (let i = 0; i < n; i++) impactState[i] = trajectory.channels[i]![row]!;
    const range = impactState[rangeChannel]!;

    // λ(T) = e_R − (e_R·f / ∇g·f) ∇g, the event-time correction as a
    // terminal condition rather than as a post-hoc adjustment. The two are the
    // same algebra; putting it here is what lets the backward solve deliver
    // the corrected gradient directly.
    const gradG = new Float64Array(n);
    eventGradientInto(event, impactTime, impactState, new Float64Array(n), gradG);

    const f = new Float64Array(n);
    problem.model.rhs(impactTime, impactState, f, problem.ctx);

    let gDot = 0;
    for (let i = 0; i < n; i++) gDot += gradG[i]! * f[i]!;
    const scale = Math.hypot(...gradG) * Math.hypot(...f);
    if (!Number.isFinite(gDot) || Math.abs(gDot) <= 1e-10 * Math.max(scale, 1)) {
      return {
        ...base,
        ok: false,
        failure:
          `the terminal event "${event.name}" is grazing at impact: dg/dt = ${gDot} against a ` +
          `scale of ${scale}, so the impact time is not differentiable and λ(T) is unbounded`,
        gradient: null,
        timeOfFlight: impactTime,
        range,
        terminalAdjoint: null,
        launchAdjoint: null,
        quadrature: null,
        stateRoundTripError: null,
        backwardReport: null,
      };
    }

    const correction = f[rangeChannel]! / gDot;
    const lambdaT = new Float64Array(n);
    lambdaT[rangeChannel] = 1;
    for (let i = 0; i < n; i++) lambdaT[i] = lambdaT[i]! - correction * gradG[i]!;

    const backwardModel = createBackwardAdjointModel(problem.model, parameters, impactTime);
    const z0 = new Float64Array(backwardDimension);
    z0.set(impactState, 0);
    z0.set(lambdaT, n);

    // The backward span is exactly the flight time; `maxSteps` and tolerances
    // come from the same config the forward solve used, so the two halves are
    // controlled to the same accuracy rather than one being quietly looser.
    const backwardConfig: SolverConfig = problem.config;
    const backwardReport = integrate(
      backwardModel,
      problem.ctx,
      z0,
      [0, impactTime],
      backwardConfig,
      problem.stepper,
      [],
    );
    if (backwardReport.status !== "ok") {
      return {
        ...base,
        ok: false,
        failure: `the backward adjoint solve did not finish (status "${backwardReport.status}")`,
        gradient: null,
        timeOfFlight: impactTime,
        range,
        terminalAdjoint: Array.from(lambdaT),
        launchAdjoint: null,
        quadrature: null,
        stateRoundTripError: null,
        backwardReport,
      };
    }

    const zFinal = backwardReport.yFinal;
    const launchAdjoint: number[] = [];
    for (let i = 0; i < n; i++) launchAdjoint.push(zFinal[n + i]!);
    const quadrature: number[] = [];
    for (let k = 0; k < m; k++) quadrature.push(zFinal[2 * n + k]!);

    // The shortcut's own error bar. `flight` was launched from the state
    // `createFlight` built, and the backward solve should have walked back to
    // it; how far it missed by is the honest measure of replaying the
    // trajectory instead of checkpointing it.
    let roundTrip = 0;
    for (let i = 0; i < n; i++) {
      roundTrip = Math.max(roundTrip, Math.abs(zFinal[i]! - trajectory.channels[i]![0]!));
    }

    const seed = new Float64Array(n);
    const gradient = parameters.map((parameter, k) => {
      let launchTerm = 0;
      if (parameter.seedInitialState !== undefined) {
        seed.fill(0);
        parameter.seedInitialState(aim, seed);
        for (let i = 0; i < n; i++) launchTerm += launchAdjoint[i]! * seed[i]!;
      }
      return launchTerm + quadrature[k]!;
    });

    return {
      ...base,
      ok: true,
      gradient,
      timeOfFlight: impactTime,
      range,
      terminalAdjoint: Array.from(lambdaT),
      launchAdjoint,
      quadrature,
      stateRoundTripError: roundTrip,
      backwardReport,
    };
  };
}
