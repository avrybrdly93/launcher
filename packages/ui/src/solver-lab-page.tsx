/**
 * Solver Lab route (§6.3 "distinct route ... side-by-side method comparison
 * against reference solution"; P3.41). Renders one column per
 * `comparison.columns` entry (Explicit Euler / Classical RK4 / DOPRI5, per
 * `SOLVER_LAB_COLUMN_STEPPERS` in `@ballista/runtime`'s `solver-lab.ts`)
 * against the tight-tolerance DOPRI5 reference solve, each with an
 * error-vs-reference readout -- this task's validation criterion. Purely
 * presentational: the caller (the app-level route) owns computing
 * `comparison` (via `runSolverLabComparison`) and the step-size `h` that
 * drives it, so this component stays trivially testable without touching
 * the solver.
 *
 * Each column also gets a `DerivationPanel` (P3.45, §6.3 "each exhibit
 * pairs the interactive view with a short derivation panel ... single-source
 * pedagogy") when `derivationSources` has that column's stepper id --
 * parsed from the exact same `*.derivation.md` text TypeDoc's docs build
 * renders (the caller loads it via a Vite `?raw` import, never a copy), so
 * the in-app panel and the generated docs page can never drift apart.
 */

import type { SolverLabComparison } from "@ballista/runtime";
import { parseDerivationMarkdown } from "@ballista/viz";
import { DerivationPanel } from "./derivation-panel.js";
import { formatCount, formatErrorReadout } from "./solver-lab-page-logic.js";

export interface SolverLabPageProps {
  readonly comparison: SolverLabComparison;
  readonly onHChange: (h: number) => void;
  readonly derivationSources: Readonly<Record<string, string>>;
}

export function SolverLabPage({ comparison, onHChange, derivationSources }: SolverLabPageProps) {
  return (
    <div class="solver-lab-page" data-testid="solver-lab-page">
      <h1>Solver Lab</h1>
      <p class="solver-lab-page-reference" data-testid="solver-lab-reference">
        Reference: {comparison.referenceStepperId} (tight tolerance), landed at t ={" "}
        {comparison.referenceTFinal.toPrecision(6)} s
      </p>

      <label class="solver-lab-page-h-control">
        Step size h (s)
        <input
          type="number"
          step="any"
          min="0"
          value={comparison.h}
          aria-label="Step size h"
          data-testid="solver-lab-h-input"
          onInput={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next) && next > 0) onHChange(next);
          }}
        />
      </label>

      <div class="solver-lab-page-columns" data-testid="solver-lab-columns">
        {comparison.columns.map((column) => (
          <div
            key={column.stepperId}
            class="solver-lab-page-column"
            data-testid={`solver-lab-column-${column.stepperId}`}
          >
            <h2>{column.label}</h2>
            <dl>
              <dt>Steps</dt>
              <dd data-testid={`solver-lab-column-${column.stepperId}-steps`}>
                {formatCount(column.nSteps)}
              </dd>

              <dt>rhs evaluations</dt>
              <dd data-testid={`solver-lab-column-${column.stepperId}-rhs`}>
                {formatCount(column.nRHS)}
              </dd>

              <dt>t_f (s)</dt>
              <dd data-testid={`solver-lab-column-${column.stepperId}-tfinal`}>
                {column.tFinal.toPrecision(6)}
              </dd>

              <dt>Error vs reference</dt>
              <dd data-testid={`solver-lab-column-${column.stepperId}-error`}>
                {formatErrorReadout(column.errorVsReference)}
              </dd>
            </dl>

            {derivationSources[column.stepperId] !== undefined && (
              <DerivationPanel
                title={`${column.label} — derivation`}
                blocks={parseDerivationMarkdown(derivationSources[column.stepperId]!)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
