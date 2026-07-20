import { scaledErrorNorm } from "./scaled-error-norm.js";
import { StepSizeUnderflowError, type Stepper, type StepResult } from "./types.js";

/**
 * Elementary ("I", integral-only) step-size controller (§4.5, eq. 4.10) for
 * embedded-pair adaptive steppers: given the tolerance-scaled error norm of
 * an attempted step (P2.26's `scaledErrorNorm`, eq. 4.9), proposes the next
 * step size
 *
 * $$h_{\text{new}} = h \cdot \min\big(f_{\max},\ \max(f_{\min},\ f_s\,
 * \text{err}^{-1/(\hat p + 1)})\big)$$
 *
 * with safety factor $f_s$ and growth/shrink clamps $f_{\min}$/$f_{\max}$.
 * Per §4.5, $f_{\max}$ is tighter ({@link IControllerConfig.maxFactorAfterRejection},
 * conventionally 1 -- never grow immediately after a rejection) when the
 * step being resized was itself just rejected, versus the looser
 * {@link IControllerConfig.maxFactor} used to size the *next* step after an
 * acceptance.
 */
export interface IControllerConfig {
  /** Safety factor $f_s$ applied to the raw eq. (4.10) estimate; conventionally 0.9. */
  readonly safety: number;
  /** Largest allowed one-step shrink factor $f_{\min}$; conventionally 0.2 (never shrink by more than 5x). */
  readonly minFactor: number;
  /** Largest allowed one-step growth factor $f_{\max}$ after an accepted step; conventionally 5. */
  readonly maxFactor: number;
  /** Tighter growth cap applied when resizing a just-rejected step; conventionally 1 (shrink or hold, never grow). */
  readonly maxFactorAfterRejection: number;
}

/** Conventional eq. (4.10) constants (§4.5): $f_s = 0.9$, $f_{\min} = 0.2$, $f_{\max} = 5$ (1 after a rejection). */
export const DEFAULT_I_CONTROLLER: IControllerConfig = {
  safety: 0.9,
  minFactor: 0.2,
  maxFactor: 5,
  maxFactorAfterRejection: 1,
};

/**
 * The clamped step-size multiplier for one controller decision (eq. 4.10).
 * `err` is the tolerance-scaled RMS norm from {@link scaledErrorNorm}
 * (accept iff `err <= 1`); `embeddedOrder` is the *lower* order $\hat p$ of
 * the embedded pair, since the error estimate is $\mathcal O(h^{\hat p+1})$
 * (eq. 4.8) and eq. (4.10)'s exponent is $-1/(\hat p+1)$. `err === 0` (a
 * perfect step) yields `Infinity` before clamping, which `Math.min` with a
 * finite `maxFactor` resolves to the growth cap, exactly as intended --
 * this needs no special-casing.
 */
export function iControllerFactor(
  err: number,
  embeddedOrder: number,
  afterRejection: boolean,
  cfg: IControllerConfig = DEFAULT_I_CONTROLLER,
): number {
  const raw = cfg.safety * Math.pow(err, -1 / (embeddedOrder + 1));
  const maxFactor = afterRejection ? cfg.maxFactorAfterRejection : cfg.maxFactor;
  return Math.min(maxFactor, Math.max(cfg.minFactor, raw));
}

/** Outcome of {@link attemptAdaptiveStep}: the accepted step plus its rejection count and suggested next `h`. */
export interface AdaptiveStepOutcome {
  /** Step size that was actually accepted (may differ from the requested `h` after rejections). */
  readonly h: number;
  /** Controller's suggestion (eq. 4.10, `afterRejection=false`) for the *next* step's initial `h`. */
  readonly hNext: number;
  /** Number of attempts rejected (`err > 1`) before this one was accepted. */
  readonly rejections: number;
  /** Total rhs evaluations consumed across every attempt (rejected and accepted). */
  readonly nRHS: number;
}

/**
 * Safety bound on consecutive rejections for a single step, guarding
 * against a pathological (mis-set) tolerance spinning forever when no
 * explicit `hMin` floor is given -- the backstop of last resort behind
 * P2.29's `hMin` check below.
 */
const MAX_CONSECUTIVE_REJECTIONS = 50;

/**
 * Runs the eq. (4.9)/(4.10) accept-reject loop (§4.5) for one step: attempts
 * `stepper.step` at `h`, scores it with {@link scaledErrorNorm}, and on
 * rejection (`err > 1`) shrinks `h` via {@link iControllerFactor} and
 * retries from the same `(t, y)` -- never partially advancing on a
 * rejected attempt. `stepper` must be an embedded-pair stepper
 * (`stepper.info.embeddedOrder` defined, passed separately as
 * `embeddedOrder` since `Stepper.info` is method-agnostic); `out` is left
 * holding the accepted attempt's `yNext`/`delta`/`errorEstimate` on return,
 * matching a plain `stepper.step` call's contract.
 *
 * `hMin` (P2.29, §4.5's mandatory "h_min floor with diagnostic failure, not
 * silent stall" guard), when given, throws a {@link StepSizeUnderflowError}
 * as soon as a rejection would shrink the retry below it, rather than
 * continuing to retry a step size known to be unreachable. Omitted (the
 * default), the loop instead falls back to the coarser
 * `MAX_CONSECUTIVE_REJECTIONS` backstop, which throws the same error type.
 */
export function attemptAdaptiveStep(
  stepper: Stepper,
  embeddedOrder: number,
  t: number,
  y: Float64Array,
  h: number,
  rtol: number,
  atol: number | Float64Array,
  out: StepResult,
  cfg: IControllerConfig = DEFAULT_I_CONTROLLER,
  hMin?: number,
): AdaptiveStepOutcome {
  let hAttempt = h;
  let rejections = 0;
  let nRHS = 0;

  for (;;) {
    stepper.step(t, y, hAttempt, out);
    nRHS += out.nRHS;

    const err = scaledErrorNorm(out.delta, y, out.yNext, rtol, atol);
    if (err <= 1) {
      const hNext = hAttempt * iControllerFactor(err, embeddedOrder, false, cfg);
      return { h: hAttempt, hNext, rejections, nRHS };
    }

    if (rejections >= MAX_CONSECUTIVE_REJECTIONS) {
      throw new StepSizeUnderflowError(
        `attemptAdaptiveStep: ${MAX_CONSECUTIVE_REJECTIONS} consecutive rejections at t=${t}, h=${hAttempt} (err=${err}); tolerance likely unreachable`,
        t,
        y,
      );
    }
    rejections++;
    hAttempt *= iControllerFactor(err, embeddedOrder, true, cfg);

    if (hMin !== undefined && hAttempt < hMin) {
      throw new StepSizeUnderflowError(
        `attemptAdaptiveStep: step size underflowed hMin=${hMin} at t=${t} (err=${err}); tolerance likely unreachable`,
        t,
        y,
      );
    }
  }
}
