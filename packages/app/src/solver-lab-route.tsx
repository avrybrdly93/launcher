/**
 * Solver Lab route (§6.3 "distinct route"; P3.41, derivation panels P3.45).
 * Wires the pedagogical `@ballista/ui` `SolverLabPage` to a live
 * `runSolverLabComparison` run: owns the step-size `h` the comparison uses,
 * recomputes on change, and re-runs against the currently committed
 * scenario. `main.tsx` mounts this in place of `App` whenever
 * `location.hash === "#/solver-lab"`.
 *
 * `DERIVATION_SOURCES` loads every `*.derivation.md` file's raw text via
 * Vite's `?raw` import (`import.meta.glob`, resolved and inlined at build
 * time) straight from `@ballista/solverkit`'s own source tree -- the exact
 * same files TypeDoc's docs build renders (P2.51), never a copy -- keyed
 * back to a stepper id via `stepperDerivationDoc`, the same lookup the
 * docs-build wiring itself uses.
 */

import type { ScenarioSpec } from "@ballista/engine";
import { DEFAULT_SCENARIO, runSolverLabComparison } from "@ballista/runtime";
import { stepperDerivationDoc } from "@ballista/solverkit";
import { SolverLabPage } from "@ballista/ui";
import { useMemo, useState } from "preact/hooks";
import "./solver-lab-route.css";

const RAW_DERIVATION_SOURCES = import.meta.glob("../../solverkit/src/*.derivation.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function derivationSourceFor(stepperId: string): string | undefined {
  const filename = stepperDerivationDoc(stepperId);
  if (!filename) return undefined;
  const key = Object.keys(RAW_DERIVATION_SOURCES).find((path) => path.endsWith(`/${filename}`));
  return key !== undefined ? RAW_DERIVATION_SOURCES[key] : undefined;
}

export interface SolverLabRouteProps {
  readonly scenario?: ScenarioSpec;
}

export function SolverLabRoute({ scenario = DEFAULT_SCENARIO }: SolverLabRouteProps) {
  const [h, setH] = useState(scenario.solver.h ?? 0.01);
  const comparison = useMemo(() => runSolverLabComparison(scenario, h), [scenario, h]);

  const derivationSources = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const column of comparison.columns) {
      const source = derivationSourceFor(column.stepperId);
      if (source !== undefined) entries[column.stepperId] = source;
    }
    return entries;
  }, [comparison]);

  return (
    <div class="solver-lab-route" data-testid="solver-lab-route">
      <a href="#/" class="solver-lab-route-back" data-testid="solver-lab-back-link">
        &larr; Back to simulator
      </a>
      <SolverLabPage
        comparison={comparison}
        onHChange={setH}
        derivationSources={derivationSources}
      />
    </div>
  );
}
