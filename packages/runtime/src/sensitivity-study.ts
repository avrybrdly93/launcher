/**
 * The drive behind P6.20's sensitivity pane: one study that runs P6.18's
 * one-at-a-time tornado and P6.19's Sobol' decomposition over the same inputs,
 * reporting progress as it goes and stopping when asked.
 *
 * **Why this lives in `runtime` and not in `analysis`.** `oneAtATimeTornado`
 * and `sobolIndices` are both synchronous functions that return one answer;
 * neither knows what progress is, and neither should. What a UI needs is the
 * orchestration around them — how many evaluations there will be, how many
 * have happened, and a way to abandon the rest — which is the same concern
 * `mc-job.ts` and `sweep-job.ts` already own for their studies. Adding an
 * `onProgress` parameter to the estimators themselves would push a UI concern
 * into the mathematics.
 *
 * **Progress is counted where the cost actually is.** Both estimators take the
 * model as an `evaluate` callback and their cost is exactly the number of
 * times they call it, so this module wraps the caller's `evaluate` and counts
 * the calls rather than instrumenting the estimators. That makes the reported
 * total an arithmetic fact about the run — `2n + 1` for the tornado, `N(d+2)`
 * for Sobol' — rather than an estimate that can drift out of step with the
 * implementations it describes.
 *
 * **Cancellation is cooperative, and it interrupts the estimator.** The wrapped
 * `evaluate` throws {@link SensitivityStudyCancelled} the first time it is
 * entered after the signal aborts, which unwinds out of whichever estimator is
 * running. It deliberately does *not* return `null` to signal a stop: `null`
 * means "this point has no answer" to both estimators, and a cancelled run that
 * reported itself as a heavily censored result would be a wrong answer rather
 * than an absent one. Censoring is a statement about the model; cancelling is a
 * statement about the user.
 */

import {
  oneAtATimeTornado,
  sobolIndices,
  type SobolIndices,
  type Tornado,
} from "@ballista/analysis";

/** Thrown out of a study whose signal aborted. Carries how far it got. */
export class SensitivityStudyCancelled extends Error {
  /** Evaluations completed before the stop. */
  readonly completed: number;

  constructor(completed: number) {
    super(`sensitivity study cancelled after ${completed} evaluation(s)`);
    this.name = "SensitivityStudyCancelled";
    this.completed = completed;
  }
}

/** Which half of the study an evaluation belongs to. */
export type SensitivityStudyStage = "tornado" | "sobol";

/** One progress report. */
export interface SensitivityStudyProgress {
  /** The half currently running. */
  readonly stage: SensitivityStudyStage;
  /** Evaluations completed across the whole study, both stages. */
  readonly completed: number;
  /** Evaluations the whole study will take, known before it starts. */
  readonly total: number;
}

/**
 * The model, given twice because the two estimators parameterise it
 * differently and neither parameterisation converts to the other without
 * assuming a distribution.
 *
 * A tornado moves inputs by *displacements from the nominal point* in physical
 * units; Sobol' samples the *unit cube* and needs the caller's own inverse-CDF
 * to place those samples. Deriving one from the other here would mean guessing
 * that marginal, and guessing it wrong silently changes what the indices mean.
 */
export interface SensitivityStudySpec {
  /** Input names, in the order every array and callback here uses. */
  readonly inputs: readonly string[];
  /** Each input's half-width for the tornado. Zero is allowed; negative is not. */
  readonly sigmas: readonly number[];
  /** The output at the nominal point displaced by `delta`. `null` where there is no answer. */
  evaluateDisplacement(delta: readonly number[]): number | null;
  /** The output at a point of the unit cube. `null` where there is no answer. */
  evaluateUnitPoint(unitPoint: readonly number[]): number | null;
}

/** Knobs, forwarded to the two estimators. */
export interface SensitivityStudyOptions {
  /** `N`, Sobol' rows per sample matrix. Default `1024` — see {@link DEFAULT_BASE_SAMPLES}. */
  readonly baseSamples?: number;
  /** Multiplier on each σ for the tornado. Default `1`. */
  readonly scale?: number;
  /** Seed for the Sobol' scramble. The same seed reproduces exactly. */
  readonly seed?: number;
  /** Scrambled Sobol' (default) or plain pseudo-random sampling. */
  readonly sampling?: "sobol" | "random";
}

/** Everything the study observed. */
export interface SensitivityStudyResult {
  readonly tornado: Tornado;
  readonly sobol: SobolIndices;
  /** Evaluations actually performed, which equals {@link SensitivityStudyCost.total}. */
  readonly evaluations: number;
}

/** What a study will cost, per stage and in total. */
export interface SensitivityStudyCost {
  /** `2n + 1` — two endpoints per input, plus the nominal every bar is measured from. */
  readonly tornado: number;
  /** `N(d + 2)` — the Saltelli/Jansen construction's evaluation count. */
  readonly sobol: number;
  readonly total: number;
}

/**
 * Rows per Sobol' sample matrix when the caller does not say.
 *
 * **Lower than `sobolIndices`' own 4096 default, deliberately.** This runs
 * behind a UI control with a person waiting on it, and the cost is `N(d+2)`
 * trajectory integrations; at `d = 3` that is 20480 evaluations against 5120.
 * The pane surfaces the standard errors precisely so that a reader can see
 * when this default is not enough and raise it, which is the honest trade — a
 * silently expensive default that always looks converged is not.
 */
export const DEFAULT_BASE_SAMPLES = 1024;

/**
 * What {@link runSensitivityStudy} will cost, computable before it starts.
 *
 * The pane needs this to draw a determinate progress bar from the first
 * evaluation rather than discovering the denominator as it goes.
 *
 * @throws If the input count or the base-sample count is not a positive integer.
 */
export function sensitivityStudyCost(
  inputCount: number,
  baseSamples: number = DEFAULT_BASE_SAMPLES,
): SensitivityStudyCost {
  if (!Number.isInteger(inputCount) || inputCount <= 0) {
    throw new Error(`sensitivityStudyCost: ${inputCount} inputs; it must be a positive integer`);
  }
  if (!Number.isInteger(baseSamples) || baseSamples <= 0) {
    throw new Error(
      `sensitivityStudyCost: baseSamples ${baseSamples} is not a positive integer; ` +
        "it is N, the rows per Sobol' sample matrix",
    );
  }
  const tornado = 2 * inputCount + 1;
  const sobol = baseSamples * (inputCount + 2);
  return { tornado, sobol, total: tornado + sobol };
}

/**
 * The abort input, typed structurally so a plain `AbortSignal` satisfies it
 * and a test can pass a two-line stub without constructing one.
 */
export interface SensitivityStudySignal {
  readonly aborted: boolean;
}

/** Side channels: progress out, cancellation in. */
export interface SensitivityStudyCallbacks {
  /**
   * Called after every evaluation. Throttling this into rendered frames is the
   * caller's concern, exactly as `runMcRange`'s `onProgress` leaves it to
   * `worker-pool.ts` — this module reports every one so that a caller which
   * wants them all can have them.
   */
  readonly onProgress?: (progress: SensitivityStudyProgress) => void;
  /** Checked before every evaluation; the study throws once it reads aborted. */
  readonly signal?: SensitivityStudySignal;
}

/**
 * Runs both estimators over `spec` and returns both answers.
 *
 * The tornado runs first because it is `2n + 1` evaluations against Sobol''s
 * `N(d+2)` — on any realistic `N` it is a rounding error of the total, so
 * running it first means the pane has a ranking to draw almost immediately and
 * the long stage fills in beneath it.
 *
 * @throws {SensitivityStudyCancelled} If the signal aborts mid-run.
 * @throws If `spec`'s arrays disagree in length, or an estimator rejects its
 *   own arguments — those errors are left to propagate verbatim rather than
 *   rewrapped, since they name the estimator that actually objected.
 */
export function runSensitivityStudy(
  spec: SensitivityStudySpec,
  options: SensitivityStudyOptions = {},
  callbacks: SensitivityStudyCallbacks = {},
): SensitivityStudyResult {
  const { inputs, sigmas } = spec;
  if (inputs.length !== sigmas.length) {
    throw new Error(
      `runSensitivityStudy: ${inputs.length} input name(s) against ${sigmas.length} sigma(s); ` +
        "they index the same inputs and must have the same length",
    );
  }
  const baseSamples = options.baseSamples ?? DEFAULT_BASE_SAMPLES;
  const cost = sensitivityStudyCost(inputs.length, baseSamples);
  const { onProgress, signal } = callbacks;

  let completed = 0;
  let stage: SensitivityStudyStage = "tornado";

  /**
   * Wraps one of the spec's callbacks so that every call is counted, and so
   * that an abort raised while the estimator is mid-loop takes effect at the
   * next evaluation rather than at the end of the stage.
   */
  const counted =
    <T extends readonly number[]>(evaluate: (point: T) => number | null) =>
    (point: T): number | null => {
      if (signal?.aborted === true) throw new SensitivityStudyCancelled(completed);
      const value = evaluate(point);
      completed += 1;
      onProgress?.({ stage, completed, total: cost.total });
      return value;
    };

  const tornado = oneAtATimeTornado(
    {
      inputs,
      sigmas,
      evaluate: counted((delta: readonly number[]) => spec.evaluateDisplacement(delta)),
    },
    options.scale === undefined ? {} : { scale: options.scale },
  );

  stage = "sobol";
  const sobol = sobolIndices(
    {
      inputs,
      evaluate: counted((unitPoint: readonly number[]) => spec.evaluateUnitPoint(unitPoint)),
    },
    {
      baseSamples,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.sampling === undefined ? {} : { sampling: options.sampling }),
    },
  );

  return { tornado, sobol, evaluations: completed };
}
