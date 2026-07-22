// L1 numerics: steppers, adaptive controllers, dense output, event detection,
// root finding.
/** This package's name, for diagnostics that need to identify their source layer. */
export const SOLVERKIT_PACKAGE = "@ballista/solverkit";

export * from "./types.js";
export * from "./cancellation-token.js";
export * from "./compensated-summation.js";
export * from "./integrate.js";
export * from "./trajectory-recorder.js";
export * from "./stats-collector.js";
export * from "./step-size-recorder.js";
export * from "./explicit-euler-stepper.js";
export * from "./two-stage-rk2-kernel.js";
export * from "./midpoint-rk2-stepper.js";
export * from "./heun-rk2-stepper.js";
export * from "./explicit-rk-kernel.js";
export * from "./embedded-rk-kernel.js";
export * from "./scaled-error-norm.js";
export * from "./i-controller.js";
export * from "./dormand-prince-54.js";
export * from "./bogacki-shampine-32.js";
export * from "./classical-rk4-stepper.js";
export * from "./semi-implicit-euler-stepper.js";
export * from "./verlet-stepper.js";
export * from "./order-condition-checker.js";
export * from "./convergence-harness.js";
export * from "./work-precision-harness.js";
export * from "./stability-boundary-sweep.js";
export * from "./micro-benchmark.js";
export * from "./event-detection.js";
export * from "./brent-root-finder.js";
export * from "./event-root-localization.js";
export * from "./hermite-dense-output.js";
export * from "./invariant-monitor.js";
export * from "./dense-linear-solve.js";
export * from "./backward-euler-stepper.js";
