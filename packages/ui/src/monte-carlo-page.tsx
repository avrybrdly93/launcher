/**
 * P6.24's Monte Carlo dashboard: distributions in, four views out.
 *
 * The route supplies `runStudy` rather than this component building one, the
 * same injection `BasinPanel` uses for `runSweep` and `SensitivityStudyPanel`
 * for its study, and for the same two reasons: a test can drive the lifecycle
 * deterministically without integrating anything, and `N` trajectory solves
 * have no business being wired up by a presentational module.
 *
 * **The four sections are four sections on purpose.** A histogram of impact
 * ranges is a count against metres; a fan is a height against seconds; a hit
 * probability is a proportion; the range estimate is a length with an
 * interval. Nothing here shares an axis with anything else, and each caption
 * says what its scale is — the same discipline `sensitivity-study-panel.tsx`
 * applies to its tornado and Sobol' bars.
 *
 * **The fan is drawn as an inline SVG rather than through Plotly.** It is five
 * polylines in a unit box; `fanGeometry` has already projected them. Pulling in
 * the plotting library for that would add a lazy-load boundary and a teardown
 * path (see P0.118) to a chart that needs neither.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import type { McDashboardProgress, McDashboardResult } from "@ballista/runtime";
import { EstimatorHelpPanel } from "./estimator-help-panel.js";
import {
  clampMcReplicates,
  fanGeometry,
  formatHitEstimate,
  formatLiveHitEstimate,
  formatRangeEstimate,
  histogramBarGeometry,
  initialMcPageState,
  isMcStudyRunning,
  liveEstimateSampleSize,
  mcPageReducer,
  mcProgressFraction,
  MC_REPLICATE_CHOICES,
  rangeHistogram,
  summarizeMcStudy,
} from "./monte-carlo-page-logic.js";

/**
 * Runs one study at the requested `N`. Reports progress as it goes and rejects
 * with an `AbortError` — or any error whose run was aborted — when `signal`
 * fires.
 */
export type McStudyRunner = (options: {
  readonly replicates: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: McDashboardProgress) => void;
}) => Promise<McDashboardResult>;

export interface MonteCarloPageProps {
  readonly runStudy: McStudyRunner;
  /** Initial `N`. Snapped onto {@link MC_REPLICATE_CHOICES}. */
  readonly initialReplicates?: number;
  /** What the hit probability is scored against, for the caption. */
  readonly targetLabel: string;
}

export function MonteCarloPage({
  runStudy,
  initialReplicates = 512,
  targetLabel,
}: MonteCarloPageProps) {
  const [state, dispatch] = useReducer(mcPageReducer, initialMcPageState);
  const [replicates, setReplicates] = useState(() => clampMcReplicates(initialReplicates));
  const controllerRef = useRef<AbortController | null>(null);

  // A study outlives the component if the user navigates away mid-run, and it
  // keeps integrating trajectories nobody will read. Same unmount abort as the
  // basin and sensitivity panels, and the same path the button uses.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const study = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start" });
    try {
      const result = await runStudy({
        replicates,
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "progress", progress }),
      });
      // A study that finished in the window between the click and the abort
      // still belongs to a cancelled run; the reducer drops it because its
      // status is no longer "running".
      dispatch({ type: "ready", result, replicates });
    } catch (error) {
      if (controller.signal.aborted) dispatch({ type: "cancelled" });
      else
        dispatch({ type: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [runStudy, replicates]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const running = isMcStudyRunning(state);
  const result = state.result;
  const fraction = mcProgressFraction(state);
  const liveEstimate = formatLiveHitEstimate(state);
  const liveSampleSize = liveEstimateSampleSize(state);

  const histogram = useMemo(
    () => (result === undefined ? undefined : histogramBarGeometry(rangeHistogram(result))),
    [result],
  );
  const fan = useMemo(() => (result === undefined ? undefined : fanGeometry(result.fan)), [result]);

  return (
    <div class="monte-carlo-page" data-testid="monte-carlo-page">
      <h2 class="monte-carlo-page__title">Uncertainty study</h2>

      {/*
        P6.30's help (ADR-019). Placed above the controls rather than at the
        foot of the page because the choice it informs — which estimator this
        question wants — is made before a study is run, not after one has
        returned four numbers. Collapsed by default, so it costs a line.
      */}
      <EstimatorHelpPanel />

      <div class="monte-carlo-page__controls">
        <label class="monte-carlo-page__replicates">
          Replicates N
          <select
            data-testid="mc-replicates"
            value={String(replicates)}
            disabled={running}
            onChange={(event) =>
              setReplicates(clampMcReplicates(Number((event.target as HTMLSelectElement).value)))
            }
          >
            {MC_REPLICATE_CHOICES.map((choice) => (
              <option key={choice} value={String(choice)}>
                {choice}
              </option>
            ))}
          </select>
        </label>

        <button type="button" data-testid="mc-run" onClick={() => void study()} disabled={running}>
          Run study
        </button>
        <button type="button" data-testid="mc-cancel" onClick={cancel} disabled={!running}>
          Cancel
        </button>
      </div>

      {running && (
        <div class="monte-carlo-page__progress">
          <progress
            data-testid="mc-progress"
            max={1}
            {...(fraction === undefined ? {} : { value: fraction })}
          />
        </div>
      )}

      <p class="monte-carlo-page__status" data-testid="mc-status">
        {summarizeMcStudy(state)}
      </p>

      {/*
        P6.25's live estimate. Rendered only while a study is running and only
        once it has something to say: before the first partial, and while
        nothing has landed, `formatLiveHitEstimate` returns undefined and this
        section is absent rather than showing a placeholder interval. A
        zero-width band at p-hat = 0 would be a claim; "not found out yet" is
        not that claim.
      */}
      {liveEstimate !== undefined && (
        <section class="monte-carlo-page__live" data-testid="mc-live-estimate">
          <h3>Hit probability so far</h3>
          <p class="monte-carlo-page__caption">
            Scored on the {liveSampleSize ?? 0} replicate(s) drawn so far. The interval narrows as
            the sample grows &mdash; it is the estimate for the sample in hand, not a preview of the
            final answer.
          </p>
          <p data-testid="mc-live-hit-estimate">{liveEstimate}</p>
        </section>
      )}

      {result !== undefined && fan !== undefined && histogram !== undefined && (
        <>
          <section class="monte-carlo-page__estimate" data-testid="mc-estimate">
            <h3>Range</h3>
            <p class="monte-carlo-page__caption">
              Sample mean over the replicates that reached the ground, with a Student&rsquo;s
              <i>t</i> interval. The sample size is part of the number.
            </p>
            <p data-testid="mc-range-estimate">{formatRangeEstimate(result)}</p>
          </section>

          <section class="monte-carlo-page__hit" data-testid="mc-hit">
            <h3>Hit probability — {targetLabel}</h3>
            <p class="monte-carlo-page__caption">
              Wilson interval, which stays inside [0,&nbsp;1] and does not collapse to zero width
              when every shot hits or none does.
            </p>
            <p data-testid="mc-hit-estimate">{formatHitEstimate(result)}</p>
          </section>

          <section class="monte-carlo-page__histogram" data-testid="mc-histogram">
            <h3>Impact range distribution</h3>
            <p class="monte-carlo-page__caption">
              Bars are replicate counts per bin; heights are relative to the tallest bin, so the
              shape is comparable between runs but the height is not a count you can read off.
            </p>
            {histogram.map((bar) => (
              <div
                class="monte-carlo-page__bin"
                key={bar.index}
                data-testid={`mc-bin-${bar.index}`}
              >
                <span class="monte-carlo-page__bin-label">
                  {bar.from.toFixed(0)}&ndash;{bar.to.toFixed(0)} m
                </span>
                <span
                  class="monte-carlo-page__bin-bar"
                  data-testid={`mc-bin-bar-${bar.index}`}
                  style={{ width: `${(bar.fraction * 100).toFixed(2)}%` }}
                />
                <span class="monte-carlo-page__bin-count">{bar.count}</span>
              </div>
            ))}
          </section>

          <section class="monte-carlo-page__fan" data-testid="mc-fan">
            <h3>Trajectory envelope</h3>
            <p class="monte-carlo-page__caption">
              Quantile bands of height against time over {result.fanReplicates} retained
              trajectories &mdash; the first {result.fanReplicates} replicates of this same
              ensemble, not a separate sample. Vertical axis {fan.yMin.toFixed(0)}&ndash;
              {fan.yMax.toFixed(0)} m; horizontal axis 0&ndash;{fan.tMax.toFixed(2)} s.
            </p>
            <svg
              class="monte-carlo-page__fan-svg"
              data-testid="mc-fan-svg"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Quantile envelope of height against time over ${result.fanReplicates} trajectories`}
            >
              {fan.bands.map((band) => (
                <polyline
                  key={band.level}
                  data-testid={`mc-fan-band-${band.level}`}
                  points={band.points}
                  fill="none"
                  vector-effect="non-scaling-stroke"
                />
              ))}
              {fan.commonSupportX !== undefined && (
                <line
                  data-testid="mc-fan-common-support"
                  x1={fan.commonSupportX}
                  x2={fan.commonSupportX}
                  y1={0}
                  y2={1}
                  vector-effect="non-scaling-stroke"
                />
              )}
            </svg>
            <p class="monte-carlo-page__caption" data-testid="mc-fan-support-note">
              {fan.commonSupportX === undefined
                ? "No grid point has every replicate in flight, so every band is conditional on survival."
                : `Past ${result.fan.commonSupportEnd.toFixed(2)} s (marked) not every replicate is still in flight, so the bands there are conditional on survival and mean something different.`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
