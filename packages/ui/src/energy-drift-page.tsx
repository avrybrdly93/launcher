/**
 * Energy-drift dashboard (§7 P3.44 shell, blueprint §4.8 "flagship
 * comparison exhibit" -- full content and automated shape assertions are
 * P4.12). Renders one E(t)/E(0)-1 trace per `study.methods` entry (Explicit
 * Euler / Classical RK4 / Symplectic Euler / Velocity Verlet, per
 * `runEnergyDriftStudy`, `@ballista/runtime`), each a genuine pinned solver
 * run at the same fixed rhs-evaluation budget -- this task's validation
 * criterion ("four-method E(t) traces render from pinned runs"). Purely
 * presentational: the caller (the app-level route) owns computing `study`.
 */

import type { EnergyDriftStudy } from "@ballista/runtime";
import { buildEnergyDriftFigure } from "@ballista/viz";
import { formatEnergyError } from "./energy-drift-page-logic.js";
import { LazyPlotlyView } from "./lazy-plotly-view.js";
import { formatCount } from "./solver-lab-page-logic.js";

export interface EnergyDriftPageProps {
  readonly study: EnergyDriftStudy;
}

export function EnergyDriftPage({ study }: EnergyDriftPageProps) {
  const figureSpec = buildEnergyDriftFigure(
    study.methods.map((method) => ({
      method: method.label,
      t: method.t,
      relativeEnergyError: method.relativeEnergyError,
    })),
  );

  return (
    <div class="energy-drift-page" data-testid="energy-drift-page">
      <h1>Energy Drift</h1>
      <p class="energy-drift-page-summary" data-testid="energy-drift-summary">
        Gravity-only lofted shot, landed at t = {study.tFinal.toPrecision(6)} s -- every method run
        at the same fixed rhs-evaluation budget.
      </p>

      <table class="energy-drift-page-methods" data-testid="energy-drift-methods">
        <thead>
          <tr>
            <th>Method</th>
            <th>Symplectic</th>
            <th>h (s)</th>
            <th>Steps</th>
            <th>rhs evaluations</th>
            <th>Final |E(t)/E(0)−1|</th>
          </tr>
        </thead>
        <tbody>
          {study.methods.map((method) => (
            <tr key={method.stepperId} data-testid={`energy-drift-method-${method.stepperId}`}>
              <td>{method.label}</td>
              <td data-testid={`energy-drift-method-${method.stepperId}-symplectic`}>
                {method.symplectic ? "yes" : "no"}
              </td>
              <td data-testid={`energy-drift-method-${method.stepperId}-h`}>
                {method.h.toPrecision(4)}
              </td>
              <td data-testid={`energy-drift-method-${method.stepperId}-steps`}>
                {formatCount(method.nSteps)}
              </td>
              <td data-testid={`energy-drift-method-${method.stepperId}-rhs`}>
                {formatCount(method.nRHS)}
              </td>
              <td data-testid={`energy-drift-method-${method.stepperId}-final-error`}>
                {formatEnergyError(Math.abs(method.relativeEnergyError.at(-1) ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <LazyPlotlyView spec={figureSpec} />
    </div>
  );
}
