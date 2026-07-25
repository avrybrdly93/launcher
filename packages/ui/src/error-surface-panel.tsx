/**
 * Error surface (§6.3, "solver failures render actionable messages -- not
 * toasts of doom"; P3.38). A failed `SimulationSession.commitScenario`
 * outcome carries a typed `reason` plus the last-good `(t, y)` (§5.1: every
 * `SolveFailure` does); this renders both -- {@link guidanceFor}'s
 * human title/next-step text, and the last-good state itself, so a user
 * (or bug reporter) can see exactly where the solve was when it gave up,
 * not just a generic "something went wrong".
 *
 * Assumes `y`'s `[x, y, vx, vy]` planar-projectile-model layout (shared
 * convention with `hud-readout.ts`/`projectile-layer.ts`) -- the only
 * `Model` this platform ships.
 */

import type { SolveFailureReason } from "@ballista/solverkit";
import { guidanceFor } from "./error-surface-logic.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** The subset of a failed `CommitOutcome` (`@ballista/runtime`) this panel needs. */
export interface FailedOutcome {
  readonly reason: SolveFailureReason;
  readonly message: string;
  readonly t: number;
  readonly y: Float64Array;
}

export interface ErrorSurfacePanelProps {
  readonly outcome: FailedOutcome;
}

/** Renders `outcome`'s failure reason as an actionable title + guidance, its raw diagnostic message, and the last-good `(t, x, y, vx, vy)` state. */
export function ErrorSurfacePanel({ outcome }: ErrorSurfacePanelProps) {
  const { title, guidance } = guidanceFor(outcome.reason);

  return (
    <div class="error-surface-panel" data-testid="error-surface-panel" data-reason={outcome.reason}>
      <p class="error-surface-title" data-testid="error-surface-title">
        {title}
      </p>
      <p class="error-surface-guidance" data-testid="error-surface-guidance">
        {guidance}
      </p>
      <p class="error-surface-message" data-testid="error-surface-message">
        {outcome.message}
      </p>
      <dl class="error-surface-last-good-state" data-testid="error-surface-last-good-state">
        <dt>t</dt>
        <dd data-testid="error-surface-t">{outcome.t}</dd>
        <dt>x</dt>
        <dd data-testid="error-surface-x">{outcome.y[X]}</dd>
        <dt>y</dt>
        <dd data-testid="error-surface-y">{outcome.y[Y]}</dd>
        <dt>vx</dt>
        <dd data-testid="error-surface-vx">{outcome.y[VX]}</dd>
        <dt>vy</dt>
        <dd data-testid="error-surface-vy">{outcome.y[VY]}</dd>
      </dl>
    </div>
  );
}
