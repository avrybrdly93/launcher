// L1 analysis: inverse problems (shooting), Monte Carlo ensembles, sensitivity
// indices. Phase 5 (§7) opens with the observable framework below; the rest of
// the surface is still the Phase 0 package skeleton.
export const ANALYSIS_PACKAGE = "@ballista/analysis";

export * from "./adjoint-range-gradient.js";
export * from "./arcs.js";
export * from "./basin-of-attraction.js";
export * from "./brent-minimize.js";
export * from "./constraints.js";
export * from "./envelope.js";
export * from "./ill-conditioning.js";
export * from "./importance-sampling.js";
export * from "./levenberg-marquardt.js";
export * from "./confidence-interval.js";
export * from "./control-variate.js";
export * from "./ensemble-fan.js";
export * from "./estimator-glossary.js";
export * from "./first-order-sensitivity.js";
export * from "./hit-probability.js";
export * from "./mc-convergence.js";
export * from "./mc-stats.js";
export * from "./min-energy.js";
export * from "./multi-start.js";
export * from "./nelder-mead.js";
export * from "./newton-convergence-order.js";
export * from "./newton-shooting.js";
export * from "./observable-sink.js";
export * from "./observables.js";
export * from "./optimal-angle.js";
export * from "./range-root.js";
export * from "./robust-aim.js";
export * from "./shooting-jacobian.js";
export * from "./shooting-residual.js";
export * from "./smart-init.js";
export * from "./sobol-indices.js";
export * from "./streaming-moments.js";
export * from "./tangent-linear.js";
export * from "./trajectory-designer.js";
export * from "./targets.js";
export * from "./tolerance-coupling.js";
export * from "./tornado.js";
export * from "./trajectory-clustering.js";
