import { scaledErrorNorm } from "./scaled-error-norm.js";
import { StepSizeUnderflowError, type Stepper, type StepResult } from "./types.js";

/**
 * PI (proportional-integral) step-size controller variant (§4.5, eq. 4.10's
 * "PI controller" paragraph) for embedded-pair adaptive steppers, selectable
 * alongside P2.27's elementary "I" controller via `SolverConfig.controller`.
 * Where the I controller reacts only to the current step's error, the PI
 * controller also feeds back the *previous accepted step's* error:
 *
 * $$h_{\text{new}} = h\, f_s\, \text{err}_k^{-\alpha}\, \text{err}_{k-1}^{\beta}$$
 *
 * with $(\alpha, \beta) \approx (0.7/\hat p,\ 0.4/\hat p)$. The extra
 * $\text{err}_{k-1}^{\beta}$ term damps the oscillatory accept/reject
 * "chatter" the I controller produces whenever the local error swings
 * sharply step to step (e.g. the drag-crisis scenario's rapidly-varying
 * $C_d(Re)$) -- a large err followed by a small one no longer whipsaws `h`
 * from one clamp to the other, since the controller remembers the trend.
 */
export interface PIControllerConfig {
  /** Safety factor $f_s$ applied to the raw eq. (4.10) estimate; conventionally 0.9. */
  readonly safety: number;
  /** Largest allowed one-step shrink factor $f_{\min}$; conventionally 0.2 (never shrink by more than 5x). */
  readonly minFactor: number;
  /** Largest allowed one-step growth factor $f_{\max}$ after an accepted step; conventionally 5. */
  readonly maxFactor: number;
  /** Tighter growth cap applied when resizing a just-rejected attempt; conventionally 1 (shrink or hold, never grow). */
  readonly maxFactorAfterRejection: number;
  /** Numerator of the current-error exponent $\alpha = \text{alphaScale}/\hat p$; conventionally 0.7. */
  readonly alphaScale: number;
  /** Numerator of the previous-error exponent $\beta = \text{betaScale}/\hat p$; conventionally 0.4. */
  readonly betaScale: number;
}

/** Conventional PI controller constants (§4.5): $f_s = 0.9$, $f_{\min} = 0.2$, $f_{\max} = 5$ (1 after a rejection), $(\alpha, \beta)$ scales $(0.7, 0.4)$. */
export const DEFAULT_PI_CONTROLLER: PIControllerConfig = {
  safety: 0.9,
  minFactor: 0.2,
  maxFactor: 5,
  maxFactorAfterRejection: 1,
  alphaScale: 0.7,
  betaScale: 0.4,
};

/**
 * Neutral seed for $\text{err}_{k-1}$ before any step of a solve has been
 * accepted -- $1^{\beta} = 1$, so the very first adaptive step's proposal
 * reduces to the $\text{err}_k^{-\alpha}$ term alone (no history to blend in
 * yet), the natural PI analog of the I controller's first step.
 */
export const INITIAL_PI_ERROR = 1;

/**
 * The clamped step-size multiplier for one PI controller decision, given the
 * just-accepted step's scaled error `errK` and the previous accepted step's
 * `errKMinus1` (or {@link INITIAL_PI_ERROR} for the solve's first step).
 * `embeddedOrder` is the embedded pair's lower order $\hat p$, matching the
 * I controller's convention (P2.27). `err === 0` (a perfect step) yields
 * `Infinity` before clamping, resolved to `maxFactor` by `Math.min`, same as
 * the I controller.
 */
export function piControllerFactor(
  errK: number,
  errKMinus1: number,
  embeddedOrder: number,
  cfg: PIControllerConfig = DEFAULT_PI_CONTROLLER,
): number {
  const alpha = cfg.alphaScale / embeddedOrder;
  const beta = cfg.betaScale / embeddedOrder;
  const raw = cfg.safety * Math.pow(errK, -alpha) * Math.pow(errKMinus1, beta);
  return Math.min(cfg.maxFactor, Math.max(cfg.minFactor, raw));
}

/**
 * Shrink factor for a *rejected* attempt (`err > 1`) being resized for
 * immediate retry within the same step. The PI blend only makes sense
 * between consecutive *accepted* steps (§4.5's history is a sequence of
 * accepted-step errors); a rejected attempt's error isn't a meaningful
 * "previous step" to blend against the next retry, so -- matching standard
 * practice (Hairer/Gustafsson) and mirroring the I controller's own
 * `afterRejection` branch -- retries fall back to the elementary
 * safety-factor-only shrink $f_s\, \text{err}^{-1/(\hat p+1)}$, clamped to
 * `maxFactorAfterRejection` (never grow while still resolving a rejection).
 */
function rejectionShrinkFactor(
  err: number,
  embeddedOrder: number,
  cfg: PIControllerConfig,
): number {
  const raw = cfg.safety * Math.pow(err, -1 / (embeddedOrder + 1));
  return Math.min(cfg.maxFactorAfterRejection, Math.max(cfg.minFactor, raw));
}

/** Outcome of {@link attemptAdaptivePIStep}: the accepted step, its rejection count, suggested next `h`, and the error to carry forward as the next call's `errKMinus1`. */
export interface AdaptivePIStepOutcome {
  /** Step size that was actually accepted (may differ from the requested `h` after rejections). */
  readonly h: number;
  /** Controller's suggestion for the *next* step's initial `h`. */
  readonly hNext: number;
  /** Number of attempts rejected (`err > 1`) before this one was accepted. */
  readonly rejections: number;
  /** Total rhs evaluations consumed across every attempt (rejected and accepted). */
  readonly nRHS: number;
  /** The accepted attempt's scaled error norm -- pass as `errKMinus1` on the next call. */
  readonly errAccepted: number;
}

/** Safety bound on consecutive rejections for a single step, same guard as P2.27's I controller. */
const MAX_CONSECUTIVE_REJECTIONS = 50;

/**
 * PI-controller analog of P2.27's `attemptAdaptiveStep`: runs the eq.
 * (4.9)/accept-reject loop for one step, but sizes the *next* step using the
 * PI blend of this step's and the previous accepted step's error
 * ({@link piControllerFactor}) instead of the I controller's current-error-only
 * rule. `errPrev` is `errKMinus1` -- the caller (`integrate`) threads
 * `outcome.errAccepted` from one call into the next call's `errPrev`,
 * seeding {@link INITIAL_PI_ERROR} before the solve's first step.
 *
 * `hMin` (P2.29) mirrors the I controller's guard: a rejection retry that
 * would shrink below it throws a {@link StepSizeUnderflowError} immediately
 * rather than continuing toward the coarser `MAX_CONSECUTIVE_REJECTIONS`
 * backstop, which throws the same error type when `hMin` is omitted.
 */
export function attemptAdaptivePIStep(
  stepper: Stepper,
  embeddedOrder: number,
  t: number,
  y: Float64Array,
  h: number,
  rtol: number,
  atol: number | Float64Array,
  errPrev: number,
  out: StepResult,
  cfg: PIControllerConfig = DEFAULT_PI_CONTROLLER,
  hMin?: number,
): AdaptivePIStepOutcome {
  let hAttempt = h;
  let rejections = 0;
  let nRHS = 0;

  for (;;) {
    stepper.step(t, y, hAttempt, out);
    nRHS += out.nRHS;

    const err = scaledErrorNorm(out.delta, y, out.yNext, rtol, atol);
    if (err <= 1) {
      const hNext = hAttempt * piControllerFactor(err, errPrev, embeddedOrder, cfg);
      return { h: hAttempt, hNext, rejections, nRHS, errAccepted: err };
    }

    if (rejections >= MAX_CONSECUTIVE_REJECTIONS) {
      throw new StepSizeUnderflowError(
        `attemptAdaptivePIStep: ${MAX_CONSECUTIVE_REJECTIONS} consecutive rejections at t=${t}, h=${hAttempt} (err=${err}); tolerance likely unreachable`,
        t,
        y,
      );
    }
    rejections++;
    hAttempt *= rejectionShrinkFactor(err, embeddedOrder, cfg);

    if (hMin !== undefined && hAttempt < hMin) {
      throw new StepSizeUnderflowError(
        `attemptAdaptivePIStep: step size underflowed hMin=${hMin} at t=${t} (err=${err}); tolerance likely unreachable`,
        t,
        y,
      );
    }
  }
}
