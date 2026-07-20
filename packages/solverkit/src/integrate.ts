import type { EvalContext, Model } from "@ballista/engine";
import { scanStepForEvents } from "./event-detection.js";
import { localizeEventRoot } from "./event-root-localization.js";
import { attemptAdaptiveStep } from "./i-controller.js";
import { attemptAdaptivePIStep, INITIAL_PI_ERROR } from "./pi-controller.js";
import {
  createStepResult,
  StepSizeUnderflowError,
  type Sink,
  type SolveFailure,
  type SolveReport,
  type SolverConfig,
  type Stepper,
} from "./types.js";

const DEFAULT_STEP_COUNT = 100;

/**
 * Absolute-tolerance floor (eq. 4.9's $atol_i$) used when `cfg.atol` is
 * unset for an adaptive solve. Purely relative tolerance (`atol=0`) is
 * hazardous whenever a channel's magnitude legitimately passes through
 * (or starts at) exactly 0 -- `sc_i` would collapse to 0 and divide any
 * nonzero `delta_i` there by zero. `1e-6` matches the blueprint's example
 * rtol scale (§4.5) and is small enough not to mask genuine relative-error
 * control on channels that stay well above it.
 */
const DEFAULT_ATOL = 1e-6;

/**
 * Relative slack applied when deciding whether the remaining span is small
 * enough to treat as the final step. Needed because summing `t += h` drifts
 * by a few ULP per step (0.1 has no exact binary representation): without
 * slack, ten 0.1-steps to t_f=1 leave `remaining` a hair above zero and spawn
 * a spurious eleventh near-zero step instead of landing exactly on t_f.
 */
const FINAL_STEP_EPS_REL = 1e-9;

/** True iff every channel of `y` is finite -- the per-accepted-step NaN/Inf guard (§5.1, P2.03). */
function isFiniteState(y: Float64Array): boolean {
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]!)) return false;
  }
  return true;
}

/**
 * Rounds every channel of `y` to the nearest IEEE 754 single-precision value
 * in place (P2.21's Float32 mode, §4.7). This is how the driver simulates
 * storing the accepted state in a `Float32Array` between steps without
 * requiring every stepper to internally compute in Float32: each step's
 * rhs is still evaluated in Float64, but the state it reads next step has
 * already lost its bits below `eps32 ≈ 1.19e-7`, which is what makes the
 * rounding-error branch of the V-curve rise so much sooner as h shrinks.
 */
function roundToFloat32(y: Float64Array): void {
  for (let i = 0; i < y.length; i++) {
    y[i] = Math.fround(y[i]!);
  }
}

/**
 * Fixed- or adaptive-step driver (§5.1): init the stepper, advance from
 * `tspan[0]` to `tspan[1]`, clamping the final step so it lands exactly on
 * t_f, dispatching every accepted step to `sinks`. Every stepped state is
 * checked for finiteness before being accepted; a NaN/Inf channel stops the
 * solve immediately with a typed `non-finite-state` failure carrying the
 * last-good (t, y) rather than propagating garbage further (§5.1's error
 * taxonomy -- "the single most valuable debugging feature in any solver").
 *
 * `cfg.rtol` set selects adaptive stepping (§4.5): each step runs P2.27's
 * eq. (4.9)/(4.10) accept-reject loop ({@link attemptAdaptiveStep}) against
 * an embedded-pair `stepper` (`stepper.info.embeddedOrder` must be
 * defined), `cfg.h` (or the same default-step-count guess the fixed path
 * uses) seeding only the *first* step's size thereafter. `cfg.atol`
 * defaults to `DEFAULT_ATOL` when unset. Rejected attempts are counted into
 * `SolveReport.nRejected` and their rhs evaluations into `nRHS`, but never
 * advance `t`. `cfg.h` set (and `cfg.rtol` unset) instead runs the plain
 * fixed-step path at (approximately) `cfg.h`. `cfg.controller` selects the
 * step-size controller for the adaptive path: `"I"` (default, P2.27) or
 * `"PI"` (P2.28) -- the PI variant additionally blends in the previous
 * accepted step's scaled error (`errPrev`, threaded across the loop and
 * seeded with {@link INITIAL_PI_ERROR}), which damps accept/reject chatter
 * on scenarios where the local error swings sharply step to step.
 *
 * Two typed-failure guards beyond P2.03's non-finite-state check (P2.29,
 * §5.1's error taxonomy -- "not a generic Error"): `cfg.maxSteps` (always
 * enforced) stops the solve with a `max-steps-exceeded` failure the instant
 * accepting another step would exceed the budget; `cfg.hMin`, when set, is
 * passed into the adaptive controller's rejection loop and -- together with
 * that loop's own `MAX_CONSECUTIVE_REJECTIONS` backstop when `hMin` is unset
 * -- throws a {@link StepSizeUnderflowError} the driver catches and converts
 * into a `step-size-underflow` failure, both carrying the last-good `(t, y)`
 * rather than propagating a raw exception or silently stalling.
 *
 * Terminal-event step truncation (§4.9 steps 1-3, P2.32-P2.35): whenever
 * `model.events` is non-empty and `stepper` exposes dense output, every
 * accepted step is scanned ({@link scanStepForEvents}) for candidate
 * crossings; every *terminal* candidate is root-localized
 * ({@link localizeEventRoot}) and the earliest one *by localized time*
 * (not bracket position -- true earliest-first ordering across event
 * types, e.g. an apex crossing earlier in the step never blocks or
 * misorders a later ground-impact from correctly stopping the solve) wins,
 * truncating the step to that exact event time/state rather than the
 * stepper's originally requested `h`, dispatched to `sinks` once, and the
 * solve ends there with `status: "ok"` (a terminal event is a normal,
 * successful stopping condition, not a failure). A model with no declared
 * events, or a stepper
 * with no `interpolant`, integrates exactly as before -- this is
 * unconditional only when both are present. Non-terminal events (e.g.
 * apex) are detected the same way but do not truncate; collecting them is
 * a future `EventCollector` sink's job, not this driver's.
 *
 * `current` and `out.yNext` are two buffers preallocated once and copied
 * between (not swapped) each step, so a stepper never sees the buffer it is
 * writing into aliased with the state it is reading from, while the loop
 * itself still allocates nothing per step beyond that one fixed-size copy.
 * `cfg.compensatedSummation` (P2.20) allocates a per-channel Kahan
 * compensation buffer and passes it to `stepper.step`, so a stepper that
 * understands the optional fifth parameter (currently
 * {@link ExplicitEulerStepper}) can Kahan-compensate its own `y + h*f`
 * addition -- the only place the low-order bits genuinely lost to rounding
 * are still recoverable (post-hoc correction against the driver's `current`
 * copy cannot recover them, since the stepper's addition has already
 * rounded by the time `integrate` sees `out.yNext`).
 */
export function integrate(
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  cfg: SolverConfig,
  stepper: Stepper,
  sinks: readonly Sink[] = [],
): SolveReport {
  const [t0, tFinal] = tspan;
  let h = cfg.h ?? (tFinal - t0) / DEFAULT_STEP_COUNT;

  const adaptive = cfg.rtol !== undefined;
  const embeddedOrder = stepper.info.embeddedOrder;
  if (adaptive && embeddedOrder === undefined) {
    throw new Error(
      `integrate: adaptive stepping (cfg.rtol set) requires an embedded-pair stepper; "${stepper.info.id}" has no embeddedOrder`,
    );
  }
  const rtol = cfg.rtol ?? 0;
  const atol = cfg.atol ?? DEFAULT_ATOL;

  stepper.init(model, ctx);

  const current = Float64Array.from(y0);
  const out = createStepResult(model.dim);
  const compensation = cfg.compensatedSummation ? new Float64Array(model.dim) : undefined;
  const float32Mode = cfg.precision === "float32";
  if (float32Mode) roundToFloat32(current);

  const usePIController = cfg.controller === "PI";

  // Event handling (§4.9, P2.32-P2.34) is only possible once the stepper
  // exposes dense output -- a fixed-step method with no `interpolant` (or a
  // model declaring no events) integrates exactly as before, unaffected.
  const events = model.events;
  const hasEvents = events !== undefined && events.length > 0 && stepper.interpolant !== undefined;
  const eventScratch = hasEvents ? new Float64Array(model.dim) : undefined;
  // Wrapped (rather than passed as `stepper.interpolant` directly) so a
  // class-based Stepper's `interpolant` method keeps its `this` binding once
  // handed to scanStepForEvents/localizeEventRoot as a bare callback --
  // `HermiteDenseOutputStepper.interpolant` reads `this.y0`/`this.f0`/etc,
  // which a detached method reference would silently lose.
  const denseInterpolant = hasEvents
    ? (theta: number, out: Float64Array) => stepper.interpolant!(theta, out)
    : undefined;

  let t = t0;
  let nSteps = 0;
  let nRHS = 0;
  let nRejected = 0;
  let errPrev = INITIAL_PI_ERROR;

  function fail(
    reason: SolveFailure["reason"],
    message: string,
    failT: number,
    y: Float64Array,
  ): SolveReport {
    const report: SolveReport = {
      status: "failed",
      tFinal: failT,
      yFinal: y,
      nSteps,
      nRHS,
      nRejected,
      failure: { reason, message, t: failT, y },
    };
    for (const sink of sinks) sink.finish?.(report);
    return report;
  }

  for (const sink of sinks) sink.start?.(model, t0, current);

  while (t < tFinal) {
    if (nSteps >= cfg.maxSteps) {
      return fail(
        "max-steps-exceeded",
        `integrate: exceeded maxSteps=${cfg.maxSteps} before reaching t_f=${tFinal} (stopped at t=${t})`,
        t,
        current,
      );
    }

    const remaining = tFinal - t;
    const isFinalAttempt = remaining <= h * (1 + FINAL_STEP_EPS_REL);
    const hStep = isFinalAttempt ? remaining : h;

    if (cfg.hMin !== undefined && h < cfg.hMin) {
      return fail(
        "step-size-underflow",
        `integrate: proposed step h=${h} fell below hMin=${cfg.hMin} at t=${t}`,
        t,
        current,
      );
    }

    // The step size actually accepted -- for a rejected-then-shrunk
    // adaptive attempt this is *less* than the requested `hStep`, which is
    // why `t` below advances by this, never by `hStep` itself (advancing by
    // the request would silently skip past the ground truth at t whenever
    // a step was rejected, exactly what P2.27's rejection loop exists to
    // prevent).
    let acceptedH: number;
    try {
      if (adaptive) {
        if (usePIController) {
          const outcome = attemptAdaptivePIStep(
            stepper,
            embeddedOrder!,
            t,
            current,
            hStep,
            rtol,
            atol,
            errPrev,
            out,
            undefined,
            cfg.hMin,
          );
          nRejected += outcome.rejections;
          nRHS += outcome.nRHS;
          h = outcome.hNext;
          acceptedH = outcome.h;
          errPrev = outcome.errAccepted;
        } else {
          const outcome = attemptAdaptiveStep(
            stepper,
            embeddedOrder!,
            t,
            current,
            hStep,
            rtol,
            atol,
            out,
            undefined,
            cfg.hMin,
          );
          nRejected += outcome.rejections;
          nRHS += outcome.nRHS;
          h = outcome.hNext;
          acceptedH = outcome.h;
        }
      } else {
        stepper.step(t, current, hStep, out, compensation);
        nRHS += out.nRHS;
        acceptedH = hStep;
      }
    } catch (e) {
      if (e instanceof StepSizeUnderflowError) {
        return fail("step-size-underflow", e.message, e.t, e.y);
      }
      throw e;
    }
    nSteps++;

    if (!isFiniteState(out.yNext)) {
      return fail(
        "non-finite-state",
        `non-finite state produced by stepper "${stepper.info.id}" advancing from t=${t}`,
        t,
        current,
      );
    }

    // Assigning t_f directly (rather than t + acceptedH) guarantees the
    // final time is bit-exact even though hStep = tFinal - t is itself
    // rounded -- but only once the *accepted* step actually covers the
    // full requested `hStep` (never true for a shrunk adaptive attempt,
    // which under-reaches t_f and must keep looping).
    const newT = isFinalAttempt && acceptedH === hStep ? tFinal : t + acceptedH;

    // Event detection + localization (§4.9 steps 1-3, P2.32-P2.34): scanned
    // against `current` (still the pre-step state here) -> `out.yNext`
    // while both endpoints are still available, before either is
    // overwritten below. Only a *terminal* crossing truncates the step; a
    // non-terminal one (e.g. apex) is left for a future Sink/P2.35 to
    // collect and this step is accepted normally.
    if (hasEvents) {
      const candidates = scanStepForEvents(
        events!,
        t,
        current,
        newT,
        out.yNext,
        denseInterpolant!,
        eventScratch!,
      );
      // Earliest-first ordering across every terminal candidate (§4.9,
      // P2.35): a step's bracket position (`thetaLo`) only coarsely orders
      // candidates -- two different events can share a bracket sub-interval,
      // and only the localized root time is the actual time-ordering the
      // blueprint means by "earliest". Terminal events are rare (far off
      // the hot path), so localizing every terminal candidate before
      // picking the minimum is cheap; non-terminal candidates (e.g. apex)
      // are intentionally never localized here -- collecting them is a
      // future `EventCollector` sink's job, not this driver's, and an
      // earlier non-terminal crossing must never block or reorder a later
      // terminal one from correctly stopping the solve.
      let earliestTerminalRoot: ReturnType<typeof localizeEventRoot> | undefined;
      for (const candidate of candidates) {
        if (!candidate.event.terminal) continue;
        const root = localizeEventRoot(
          candidate,
          t,
          newT,
          current,
          out.yNext,
          denseInterpolant!,
          eventScratch!,
        );
        if (earliestTerminalRoot === undefined || root.t < earliestTerminalRoot.t) {
          earliestTerminalRoot = root;
        }
      }
      if (earliestTerminalRoot !== undefined) {
        const root = earliestTerminalRoot;
        out.yNext.set(root.y);
        out.h = root.t - t;
        current.set(root.y);
        if (float32Mode) roundToFloat32(current);
        t = root.t;
        for (const sink of sinks) sink.accept?.(t, current, out);
        const report: SolveReport = {
          status: "ok",
          tFinal: t,
          yFinal: current,
          nSteps,
          nRHS,
          nRejected,
        };
        for (const sink of sinks) sink.finish?.(report);
        return report;
      }
    }

    current.set(out.yNext);
    if (float32Mode) roundToFloat32(current);
    t = newT;
    for (const sink of sinks) sink.accept?.(t, current, out);
  }

  const report: SolveReport = {
    status: "ok",
    tFinal: t,
    yFinal: current,
    nSteps,
    nRHS,
    nRejected,
  };

  for (const sink of sinks) sink.finish?.(report);

  return report;
}
