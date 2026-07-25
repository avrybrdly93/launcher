/**
 * Convergence-study runner page (§6.3 "convergence-study runner: pick
 * scenario + methods + h ladder -> auto log-log plot with fitted slopes";
 * P3.42). Purely presentational, mirroring `SolverLabPage`'s split: the
 * caller (the app-level route) owns picking the scenario/methods/h-ladder
 * state and recomputing `study` (via `runConvergenceStudy`,
 * `@ballista/runtime`) on change.
 *
 * The displayed slope column reads `method.slope` directly off `study` --
 * the same `ConvergenceStudyResult` `convergenceStudyToJSON` serializes --
 * so "slopes displayed match harness JSON" (this task's validation
 * criterion) holds by construction: there is only one slope value, read
 * from one place.
 */

import type { ScenarioSpec } from "@ballista/engine";
import { CONVERGENCE_STUDY_METHOD_OPTIONS, type ConvergenceStudyResult } from "@ballista/runtime";
import { buildConvergenceFigure } from "@ballista/viz";
import { formatSlope, parseHLadder } from "./convergence-study-page-logic.js";
import { LazyPlotlyView } from "./lazy-plotly-view.js";

export interface ScenarioOption {
  readonly id: string;
  readonly label: string;
  readonly spec: ScenarioSpec;
}

export interface ConvergenceStudyPageProps {
  readonly scenarioOptions: readonly ScenarioOption[];
  readonly selectedScenarioId: string;
  readonly onSelectScenario: (id: string) => void;
  readonly selectedMethodIds: readonly string[];
  readonly onToggleMethod: (id: string) => void;
  readonly hLadderText: string;
  readonly onHLadderTextChange: (text: string) => void;
  readonly study: ConvergenceStudyResult;
}

export function ConvergenceStudyPage({
  scenarioOptions,
  selectedScenarioId,
  onSelectScenario,
  selectedMethodIds,
  onToggleMethod,
  hLadderText,
  onHLadderTextChange,
  study,
}: ConvergenceStudyPageProps) {
  const figureSpec = buildConvergenceFigure(
    study.methods.map((method) => ({ method: method.label, hs: method.hs, errors: method.errors })),
  );
  const hLadderValid = parseHLadder(hLadderText).length >= 2;

  return (
    <div class="convergence-study-page" data-testid="convergence-study-page">
      <h1>Convergence Study</h1>

      <label class="convergence-study-page-scenario">
        Scenario
        <select
          aria-label="Scenario"
          data-testid="convergence-study-scenario-select"
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

      <fieldset class="convergence-study-page-methods" data-testid="convergence-study-methods">
        <legend>Methods</legend>
        {CONVERGENCE_STUDY_METHOD_OPTIONS.map((option) => (
          <label key={option.id} class="convergence-study-page-method">
            <input
              type="checkbox"
              checked={selectedMethodIds.includes(option.id)}
              aria-label={option.label}
              data-testid={`convergence-study-method-${option.id}`}
              onChange={() => onToggleMethod(option.id)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <label class="convergence-study-page-h-ladder">
        h ladder (comma-separated)
        <input
          type="text"
          value={hLadderText}
          aria-label="h ladder"
          data-testid="convergence-study-h-ladder-input"
          onInput={(event) => onHLadderTextChange(event.currentTarget.value)}
        />
        {!hLadderValid && (
          <span
            class="convergence-study-page-h-ladder-warning"
            data-testid="convergence-study-h-ladder-warning"
          >
            Needs at least 2 positive step sizes to fit a slope.
          </span>
        )}
      </label>

      <table class="convergence-study-page-slopes" data-testid="convergence-study-slopes">
        <thead>
          <tr>
            <th>Method</th>
            <th>Fitted order (slope)</th>
          </tr>
        </thead>
        <tbody>
          {study.methods.map((method) => (
            <tr key={method.stepperId} data-testid={`convergence-study-slope-${method.stepperId}`}>
              <td>{method.label}</td>
              <td data-testid={`convergence-study-slope-${method.stepperId}-value`}>
                {formatSlope(method.slope)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <LazyPlotlyView spec={figureSpec} />
    </div>
  );
}
