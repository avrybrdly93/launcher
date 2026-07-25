/**
 * Stability-explorer route (§6.3 "distinct route"; P3.43). Owns the
 * scenario/method/h/scrub-position selection state and recomputes
 * `sampleTrajectoryEigenvalues` on scenario change, feeding the
 * presentational `StabilityExplorerPage` (`@ballista/ui`) -- mirrors
 * `convergence-study-route.tsx`'s split between live state (here) and
 * rendering (there). `h` and the scrub position don't need a recompute:
 * they only rescale/reselect already-sampled eigenvalues, which
 * `StabilityExplorerPage` does itself.
 */

import { PRESET_SCENARIOS } from "@ballista/engine";
import { sampleTrajectoryEigenvalues } from "@ballista/runtime";
import {
  DEFAULT_STABILITY_H,
  formatH,
  StabilityExplorerPage,
  type StabilityScenarioOption,
} from "@ballista/ui";
import { useMemo, useState } from "preact/hooks";
import "./solver-lab-route.css";

const SCENARIO_OPTIONS: readonly StabilityScenarioOption[] = PRESET_SCENARIOS.map((spec) => ({
  id: spec.projectile.id,
  label: spec.projectile.name,
  spec,
}));

const DEFAULT_METHOD_ID = "classical-rk4";

export function StabilityExplorerRoute() {
  const [scenarioId, setScenarioId] = useState(SCENARIO_OPTIONS[0]!.id);
  const [methodId, setMethodId] = useState(DEFAULT_METHOD_ID);
  const [hText, setHText] = useState(formatH(DEFAULT_STABILITY_H));
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);

  const scenario = SCENARIO_OPTIONS.find((option) => option.id === scenarioId)!.spec;

  const result = useMemo(() => sampleTrajectoryEigenvalues(scenario), [scenarioId]);

  return (
    <div class="solver-lab-route" data-testid="stability-explorer-route">
      <a href="#/" class="solver-lab-route-back" data-testid="stability-explorer-back-link">
        &larr; Back to simulator
      </a>
      <StabilityExplorerPage
        scenarioOptions={SCENARIO_OPTIONS}
        selectedScenarioId={scenarioId}
        onSelectScenario={(id) => {
          setScenarioId(id);
          setSelectedSampleIndex(0);
        }}
        selectedMethodId={methodId}
        onSelectMethod={setMethodId}
        hText={hText}
        onHTextChange={setHText}
        result={result}
        selectedSampleIndex={selectedSampleIndex}
        onSelectedSampleIndexChange={setSelectedSampleIndex}
      />
    </div>
  );
}
