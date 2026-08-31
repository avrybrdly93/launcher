/**
 * Convergence-study route (§6.3 "distinct route"; P3.42). Owns the
 * scenario/methods/h-ladder selection state and recomputes
 * `runConvergenceStudy` on every change, feeding the presentational
 * `ConvergenceStudyPage` (`@ballista/ui`) -- mirrors `solver-lab-route.tsx`'s
 * split between live state (here) and rendering (there).
 */

import { runConvergenceStudy } from "@ballista/runtime";
import {
  ConvergenceStudyPage,
  DEFAULT_H_LADDER,
  formatHLadder,
  parseHLadder,
  type ScenarioOption,
} from "@ballista/ui";
import { useMemo, useState } from "preact/hooks";
import { PRESET_SCENARIO_OPTIONS } from "./preset-scenario-options.js";
import "./solver-lab-route.css";

// P0.115: keyed by curated scenario identity, not by projectile id -- two
// presets share a projectile ("baseball", the matched headwind/tailwind pair)
// and the old derivation made the second unreachable. See the module doc.
const SCENARIO_OPTIONS: readonly ScenarioOption[] = PRESET_SCENARIO_OPTIONS;

const DEFAULT_METHOD_IDS: readonly string[] = ["explicit-euler", "classical-rk4", "dopri5"];

export function ConvergenceStudyRoute() {
  const [scenarioId, setScenarioId] = useState(SCENARIO_OPTIONS[0]!.id);
  const [methodIds, setMethodIds] = useState<readonly string[]>(DEFAULT_METHOD_IDS);
  const [hLadderText, setHLadderText] = useState(formatHLadder(DEFAULT_H_LADDER));

  function toggleMethod(id: string): void {
    setMethodIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  const scenario = SCENARIO_OPTIONS.find((option) => option.id === scenarioId)!.spec;
  const hs = parseHLadder(hLadderText);
  const effectiveHs = hs.length >= 2 ? hs : DEFAULT_H_LADDER;
  const effectiveMethodIds = methodIds.length > 0 ? methodIds : DEFAULT_METHOD_IDS;

  // `effectiveHs`/`effectiveMethodIds` are freshly derived every render, so
  // depending on the primitives that actually determine their content
  // (rather than their array identities) avoids recomputing the study on
  // every render for no reason.
  const study = useMemo(
    () => runConvergenceStudy(scenario, effectiveMethodIds, effectiveHs),
    [scenarioId, methodIds.join(","), hLadderText],
  );

  return (
    <div class="solver-lab-route" data-testid="convergence-study-route">
      <a href="#/" class="solver-lab-route-back" data-testid="convergence-study-back-link">
        &larr; Back to simulator
      </a>
      <ConvergenceStudyPage
        scenarioOptions={SCENARIO_OPTIONS}
        selectedScenarioId={scenarioId}
        onSelectScenario={setScenarioId}
        selectedMethodIds={methodIds}
        onToggleMethod={toggleMethod}
        hLadderText={hLadderText}
        onHLadderTextChange={setHLadderText}
        study={study}
      />
    </div>
  );
}
