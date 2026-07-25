/**
 * Stability-region explorer page (§4.6, P3.43): "renders |R(z)|=1 contours
 * interactively and overlays the actual eigenvalues h*lambda_i of the
 * current scenario's Jacobian along the trajectory, animating how z
 * migrates as the projectile decelerates". Purely presentational, mirroring
 * `ConvergenceStudyPage`'s split: the caller (the app-level route) owns
 * picking the scenario/method/h state and recomputing `result` (via
 * `sampleTrajectoryEigenvalues`, `@ballista/runtime`) on change.
 *
 * "Animating how z migrates" is a scrub over the already-computed sample
 * array (a time slider), not a re-solve per frame -- `selectedSampleIndex`
 * picks which single `h*lambda` point the readout describes, while the plot
 * itself always shows every sampled point at once so the migration is
 * visible as a scatter, not hidden behind the scrubber.
 */

import type { ScenarioSpec } from "@ballista/engine";
import { STABILITY_EXPLORER_METHOD_OPTIONS, type StabilityExplorerResult } from "@ballista/runtime";
import { buildStabilityRegionFigure } from "@ballista/viz";
import {
  defaultStabilityRegionRange,
  formatComplex,
  parseH,
  scaleEigenvaluesByH,
} from "./stability-explorer-page-logic.js";
import { LazyPlotlyView } from "./lazy-plotly-view.js";

export interface StabilityScenarioOption {
  readonly id: string;
  readonly label: string;
  readonly spec: ScenarioSpec;
}

export interface StabilityExplorerPageProps {
  readonly scenarioOptions: readonly StabilityScenarioOption[];
  readonly selectedScenarioId: string;
  readonly onSelectScenario: (id: string) => void;
  readonly selectedMethodId: string;
  readonly onSelectMethod: (id: string) => void;
  readonly hText: string;
  readonly onHTextChange: (text: string) => void;
  readonly result: StabilityExplorerResult;
  readonly selectedSampleIndex: number;
  readonly onSelectedSampleIndexChange: (index: number) => void;
}

export function StabilityExplorerPage({
  scenarioOptions,
  selectedScenarioId,
  onSelectScenario,
  selectedMethodId,
  onSelectMethod,
  hText,
  onHTextChange,
  result,
  selectedSampleIndex,
  onSelectedSampleIndexChange,
}: StabilityExplorerPageProps) {
  const method =
    STABILITY_EXPLORER_METHOD_OPTIONS.find((option) => option.id === selectedMethodId) ??
    STABILITY_EXPLORER_METHOD_OPTIONS[0]!;
  const h = parseH(hText);
  const hValid = h !== undefined;

  const eigenvaluePoints = h !== undefined ? scaleEigenvaluesByH(result.samples, h) : [];
  const { reRange, imRange } = defaultStabilityRegionRange(method.order);
  const figureSpec = buildStabilityRegionFigure(
    method.order,
    method.label,
    reRange,
    imRange,
    eigenvaluePoints,
  );

  const clampedIndex = Math.min(selectedSampleIndex, Math.max(0, result.samples.length - 1));
  const selectedSample = result.samples[clampedIndex];

  return (
    <div class="stability-explorer-page" data-testid="stability-explorer-page">
      <h1>Stability Region Explorer</h1>

      <label class="stability-explorer-page-scenario">
        Scenario
        <select
          aria-label="Scenario"
          data-testid="stability-explorer-scenario-select"
          value={selectedScenarioId}
          onInput={(event) => onSelectScenario(event.currentTarget.value)}
        >
          {scenarioOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label class="stability-explorer-page-method">
        Method
        <select
          aria-label="Method"
          data-testid="stability-explorer-method-select"
          value={selectedMethodId}
          onInput={(event) => onSelectMethod(event.currentTarget.value)}
        >
          {STABILITY_EXPLORER_METHOD_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label class="stability-explorer-page-h">
        Step size h (s)
        <input
          type="text"
          value={hText}
          aria-label="Step size h"
          data-testid="stability-explorer-h-input"
          onInput={(event) => onHTextChange(event.currentTarget.value)}
        />
        {!hValid && (
          <span
            class="stability-explorer-page-h-warning"
            data-testid="stability-explorer-h-warning"
          >
            h must be a positive number.
          </span>
        )}
      </label>

      {result.samples.length > 0 && (
        <label class="stability-explorer-page-scrub">
          Trajectory position (t = {selectedSample!.t.toFixed(3)} s, speed ={" "}
          {selectedSample!.speed.toFixed(3)} m/s)
          <input
            type="range"
            min={0}
            max={result.samples.length - 1}
            value={clampedIndex}
            aria-label="Trajectory position"
            data-testid="stability-explorer-scrub"
            onInput={(event) => onSelectedSampleIndexChange(Number(event.currentTarget.value))}
          />
        </label>
      )}

      {selectedSample && h !== undefined && (
        <table class="stability-explorer-page-readout" data-testid="stability-explorer-readout">
          <thead>
            <tr>
              <th>λ (1/s)</th>
              <th>z = h·λ</th>
            </tr>
          </thead>
          <tbody>
            {selectedSample.lambda.map((lambda, i) => (
              <tr key={i} data-testid={`stability-explorer-lambda-${i}`}>
                <td data-testid={`stability-explorer-lambda-${i}-value`}>
                  {formatComplex(lambda)}
                </td>
                <td data-testid={`stability-explorer-z-${i}-value`}>
                  {formatComplex({ re: h * lambda.re, im: h * lambda.im })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <LazyPlotlyView spec={figureSpec} />
    </div>
  );
}
