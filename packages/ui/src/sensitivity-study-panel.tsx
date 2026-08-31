/**
 * P6.20's sensitivity pane: the one-at-a-time tornado (P6.18) and the Sobol'
 * decomposition (P6.19) over one scenario, with a control for `N` and a
 * determinate progress bar that a Cancel button can stop.
 *
 * **The two charts are drawn as two charts, deliberately.** A tornado bar is a
 * length in output units; a Sobol' bar is a share of variance. Stacking them on
 * one axis would invite reading a metre against a fraction, so they get
 * separate sections, separate scales, and a caption each saying what the scale
 * is. `sensitivity-study-panel-logic.ts` carries the reasoning in full.
 *
 * **`runStudy` is a prop rather than something this component builds**, the same
 * injection `BasinPanel` uses for `runSweep` and for the same two reasons: a
 * test can drive the lifecycle deterministically without a real Worker, and a
 * study is `N(d+2)` trajectory integrations that have no business running on
 * the UI thread when the app wires this up for real.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";
import type { SensitivityStudyProgress, SensitivityStudyResult } from "@ballista/runtime";

import {
  clampBaseSamples,
  formatInteractionShare,
  initialSensitivityStudyState,
  isStudying,
  progressFraction,
  sensitivityStudyReducer,
  sobolBarGeometry,
  SOBOL_SAMPLE_CHOICES,
  summarizeStudy,
  tornadoBarGeometry,
} from "./sensitivity-study-panel-logic.js";

/**
 * Runs one study. Reports progress as it goes and rejects with an `AbortError`
 * — or any error whose run was aborted — when `signal` fires.
 */
export type SensitivityStudyRunner = (options: {
  readonly baseSamples: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SensitivityStudyProgress) => void;
}) => Promise<SensitivityStudyResult>;

export interface SensitivityStudyPanelProps {
  readonly runStudy: SensitivityStudyRunner;
  /** Initial `N`. Snapped onto {@link SOBOL_SAMPLE_CHOICES}. */
  readonly initialBaseSamples?: number;
}

function percentLabel(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function SensitivityStudyPanel({
  runStudy,
  initialBaseSamples = 1024,
}: SensitivityStudyPanelProps) {
  const [state, dispatch] = useReducer(sensitivityStudyReducer, initialSensitivityStudyState);
  const [baseSamples, setBaseSamples] = useState(() => clampBaseSamples(initialBaseSamples));
  const controllerRef = useRef<AbortController | null>(null);

  // A study outlives the component if the user navigates away mid-run, and its
  // workers keep integrating trajectories nobody will read. Same unmount abort
  // as the basin panel, and the same path the button uses.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const study = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start" });
    try {
      const result = await runStudy({
        baseSamples,
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "progress", progress }),
      });
      // A study that finished in the window between the click and the abort
      // still belongs to a cancelled run; the reducer drops it because its
      // status is no longer "running".
      dispatch({ type: "ready", result, baseSamples });
    } catch (error) {
      if (controller.signal.aborted) dispatch({ type: "cancelled" });
      else
        dispatch({ type: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [runStudy, baseSamples]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const studying = isStudying(state);
  const result = state.result;
  const fraction = progressFraction(state);

  return (
    <div class="sensitivity-study-panel" data-testid="sensitivity-study-panel">
      <h2 class="sensitivity-study-panel__title">Sensitivity</h2>

      <div class="sensitivity-study-panel__controls">
        <label class="sensitivity-study-panel__samples">
          Sobol&rsquo; samples N
          <select
            data-testid="sensitivity-study-samples"
            value={String(baseSamples)}
            disabled={studying}
            onChange={(event) =>
              setBaseSamples(clampBaseSamples(Number((event.target as HTMLSelectElement).value)))
            }
          >
            {SOBOL_SAMPLE_CHOICES.map((choice) => (
              <option key={choice} value={String(choice)}>
                {choice}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          data-testid="sensitivity-study-run"
          onClick={() => void study()}
          disabled={studying}
        >
          Recompute
        </button>
        <button
          type="button"
          data-testid="sensitivity-study-cancel"
          onClick={cancel}
          disabled={!studying}
        >
          Cancel
        </button>
      </div>

      {studying && (
        <div class="sensitivity-study-panel__progress">
          <progress
            data-testid="sensitivity-study-progress"
            max={1}
            {...(fraction === undefined ? {} : { value: fraction })}
          />
        </div>
      )}

      <p class="sensitivity-study-panel__status" data-testid="sensitivity-study-status">
        {summarizeStudy(state)}
      </p>

      {result !== undefined && (
        <>
          <section class="sensitivity-study-panel__tornado" data-testid="sensitivity-study-tornado">
            <h3>
              Tornado — range shift at &plusmn;{result.tornado.scale}&sigma;, one input at a time
            </h3>
            <p class="sensitivity-study-panel__caption">
              Bar length is |high &minus; low| in output units, scaled against the widest bar.
            </p>
            {tornadoBarGeometry(result.tornado).map((geometry) => (
              <div
                class="sensitivity-study-panel__row"
                key={geometry.input}
                data-testid={`tornado-row-${geometry.input}`}
              >
                <span class="sensitivity-study-panel__label">{geometry.input}</span>
                <span
                  class="sensitivity-study-panel__bar"
                  data-testid={`tornado-bar-${geometry.input}`}
                  style={{ width: `${(geometry.fraction * 100).toFixed(2)}%` }}
                />
                <span class="sensitivity-study-panel__value">
                  {geometry.censored
                    ? "no answer at one endpoint"
                    : `${geometry.span?.toFixed(3) ?? "—"}${geometry.monotone ? "" : " (folded — bar sits at a local extremum)"}`}
                </span>
              </div>
            ))}
          </section>

          <section class="sensitivity-study-panel__sobol" data-testid="sensitivity-study-sobol">
            <h3>Sobol&rsquo; indices — share of output variance</h3>
            <p class="sensitivity-study-panel__caption">
              Fixed 0&ndash;100% scale. S&#8342; is this input alone; S&#8348; adds every
              interaction it appears in.
            </p>
            {sobolBarGeometry(result.sobol).map((geometry) => (
              <div
                class="sensitivity-study-panel__row"
                key={geometry.input}
                data-testid={`sobol-row-${geometry.input}`}
              >
                <span class="sensitivity-study-panel__label">{geometry.input}</span>
                <span
                  class="sensitivity-study-panel__bar sensitivity-study-panel__bar--first"
                  data-testid={`sobol-first-bar-${geometry.input}`}
                  style={{ width: `${(geometry.firstWidth * 100).toFixed(2)}%` }}
                />
                <span
                  class="sensitivity-study-panel__bar sensitivity-study-panel__bar--total"
                  data-testid={`sobol-total-bar-${geometry.input}`}
                  style={{ width: `${(geometry.totalWidth * 100).toFixed(2)}%` }}
                />
                <span class="sensitivity-study-panel__value">
                  {`S=${percentLabel(geometry.first)} / Sᴛ=${percentLabel(geometry.total)}`}
                  {geometry.indistinguishableFromZero
                    ? " — within 2 s.e. of zero; raise N before believing it"
                    : ""}
                </span>
              </div>
            ))}
            <p
              class="sensitivity-study-panel__interaction"
              data-testid="sensitivity-study-interaction"
            >
              {formatInteractionShare(result.sobol)}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
