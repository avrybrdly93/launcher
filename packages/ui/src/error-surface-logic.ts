/**
 * Solver-failure -> actionable-guidance mapping (§6.3 accessibility/error
 * requirement, "error surfaces: solver failures render actionable messages
 * (not toasts of doom)"; P3.38). `SolveFailureReason` (§5.1 error taxonomy,
 * P2.03/P2.29) is a closed set of exactly four ways a solve can fail to
 * reach t_f; this module is the one place each gets a human title and a
 * next-step suggestion, so a new UI surface (a panel, a toast, a log line)
 * never has to invent its own copy for the same failure.
 */

import type { SolveFailureReason } from "@ballista/solverkit";

/** One failure reason's user-facing copy: what happened, and what to try next. */
export interface ErrorGuidance {
  readonly title: string;
  readonly guidance: string;
}

const GUIDANCE: Readonly<Record<SolveFailureReason, ErrorGuidance>> = {
  "step-size-underflow": {
    title: "Step size collapsed",
    guidance:
      "The solver had to shrink its step below the allowed minimum to keep the local error in tolerance. Try loosening rtol/atol, raising or removing h_min, or switching to a stiffer-aware method if this scenario is numerically stiff (e.g. very high drag relative to mass).",
  },
  "max-steps-exceeded": {
    title: "Ran out of steps",
    guidance:
      "The solve hit its step budget before reaching the end of the scenario. Try raising maxSteps, using a larger fixed step h, loosening rtol/atol on an adaptive method, or checking whether the scenario should already have ended (e.g. a missing ground-impact event).",
  },
  "non-finite-state": {
    title: "State became non-finite",
    guidance:
      "A state value turned into NaN or Infinity mid-solve -- often a force or coefficient dividing by (near-)zero, such as drag at zero relative speed, or a step too large for a stiff regime. Check for degenerate parameters (zero mass/radius) and try a smaller step or tighter tolerance.",
  },
  "event-localization-failure": {
    title: "Couldn't localize an event",
    guidance:
      "The solver detected a crossing (e.g. ground impact or apex) but couldn't pin down its exact time within tolerance -- typically a very shallow or tangential crossing. Try a smaller step size near the event, or loosen the event tolerance if this crossing is expected to be shallow.",
  },
};

/** The title + actionable guidance for `reason` -- every {@link SolveFailureReason} is covered, so this never falls back to a generic message. */
export function guidanceFor(reason: SolveFailureReason): ErrorGuidance {
  return GUIDANCE[reason];
}
