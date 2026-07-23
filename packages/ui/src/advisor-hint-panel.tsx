/**
 * Advisor hint (§6.3 Solver panel group: "advisor hints inline"; P3.24).
 * Wraps `recommendSolver` (`@ballista/engine`, P2.47) -- a pure function of
 * a `ScenarioSpec`'s own dimensionless character, not a store-coupled
 * computation -- and surfaces its rationale/warning inline, plus a doc link
 * to the recommended stepper's derivation page (`stepperDerivationDoc`,
 * `@ballista/solverkit`, P2.51's literate derivation pages).
 */

import { recommendSolver, type ScenarioSpec } from "@ballista/engine";
import { stepperDerivationDoc } from "@ballista/solverkit";

export interface AdvisorHintPanelProps {
  readonly scenario: ScenarioSpec;
}

export function AdvisorHintPanel({ scenario }: AdvisorHintPanelProps) {
  const recommendation = recommendSolver(scenario);
  const docFile = stepperDerivationDoc(recommendation.recommendedStepperId);

  return (
    <div
      class="advisor-hint-panel"
      data-testid="advisor-hint-panel"
      data-regime={recommendation.regime}
    >
      <p class="advisor-hint-rationale" data-testid="advisor-hint-rationale">
        {recommendation.rationale}
      </p>

      {recommendation.warning !== undefined && (
        <p class="advisor-hint-warning" data-testid="advisor-hint-warning">
          {recommendation.warning}
        </p>
      )}

      {docFile !== undefined && (
        <a class="advisor-hint-doc-link" data-testid="advisor-hint-doc-link" href={`./${docFile}`}>
          View derivation ({recommendation.recommendedStepperId})
        </a>
      )}
    </div>
  );
}
