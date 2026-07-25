/**
 * Solver Lab route (§6.3 "distinct route"; P3.41). Wires the pedagogical
 * `@ballista/ui` `SolverLabPage` to a live `runSolverLabComparison` run:
 * owns the step-size `h` the comparison uses, recomputes on change, and
 * re-runs against the currently committed scenario. `main.tsx` mounts this
 * in place of `App` whenever `location.hash === "#/solver-lab"`.
 */

import type { ScenarioSpec } from "@ballista/engine";
import { DEFAULT_SCENARIO, runSolverLabComparison } from "@ballista/runtime";
import { SolverLabPage } from "@ballista/ui";
import { useMemo, useState } from "preact/hooks";
import "./solver-lab-route.css";

export interface SolverLabRouteProps {
  readonly scenario?: ScenarioSpec;
}

export function SolverLabRoute({ scenario = DEFAULT_SCENARIO }: SolverLabRouteProps) {
  const [h, setH] = useState(scenario.solver.h ?? 0.01);
  const comparison = useMemo(() => runSolverLabComparison(scenario, h), [scenario, h]);

  return (
    <div class="solver-lab-route" data-testid="solver-lab-route">
      <a href="#/" class="solver-lab-route-back" data-testid="solver-lab-back-link">
        &larr; Back to simulator
      </a>
      <SolverLabPage comparison={comparison} onHChange={setH} />
    </div>
  );
}
