// dev-only package: analytical reference solutions, convergence harness,
// golden-trajectory store (§8). Not imported by any runtime layer (L0-L5);
// consumed only by tests and CI tooling.
export const VALIDATION_PACKAGE = "@ballista/validation";

export * from "./analytic-references.js";
export * from "./reference-solution.js";
