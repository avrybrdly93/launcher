// L1 analysis: inverse problems (shooting), Monte Carlo ensembles, sensitivity
// indices. Phase 5 (§7) opens with the observable framework below; the rest of
// the surface is still the Phase 0 package skeleton.
export const ANALYSIS_PACKAGE = "@ballista/analysis";

export * from "./arcs.js";
export * from "./basin-of-attraction.js";
export * from "./brent-minimize.js";
export * from "./constraints.js";
export * from "./envelope.js";
export * from "./min-energy.js";
export * from "./nelder-mead.js";
export * from "./newton-convergence-order.js";
export * from "./newton-shooting.js";
export * from "./observables.js";
export * from "./optimal-angle.js";
export * from "./range-root.js";
export * from "./robust-aim.js";
export * from "./shooting-jacobian.js";
export * from "./shooting-residual.js";
export * from "./smart-init.js";
export * from "./tangent-linear.js";
export * from "./targets.js";
