// L1 analysis: inverse problems (shooting), Monte Carlo ensembles, sensitivity
// indices. Phase 5 (§7) opens with the observable framework below; the rest of
// the surface is still the Phase 0 package skeleton.
export const ANALYSIS_PACKAGE = "@ballista/analysis";

export * from "./arcs.js";
export * from "./envelope.js";
export * from "./newton-shooting.js";
export * from "./observables.js";
export * from "./range-root.js";
export * from "./shooting-jacobian.js";
export * from "./shooting-residual.js";
export * from "./smart-init.js";
export * from "./tangent-linear.js";
export * from "./targets.js";
