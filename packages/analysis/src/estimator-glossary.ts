/**
 * The estimator glossary and when-to-use table (P6.30, ADR-019).
 *
 * By the end of phase 6 this repository owns five ways to answer a question
 * about an uncertain shot, built by five separate tasks and documented in five
 * separate module headers. Each of those headers is excellent on its own
 * subject and none of them answers the question a reader at the Monte Carlo
 * dashboard actually has, which is **which one of these do I want**. That
 * question is comparative, so it cannot be answered inside any single module,
 * and it is the reason this table exists as its own artefact.
 *
 * ## Why this is data rather than prose
 *
 * The obvious form for a glossary is a Markdown table in the ADR, with the
 * dashboard linking to it. That is one source of truth as long as nobody
 * changes anything, and the moment a module moves or an export is renamed the
 * table keeps rendering, keeps looking authoritative, and is wrong. Nothing
 * fails.
 *
 * So the rows live here, the ADR and the dashboard both derive from them, and
 * `estimator-glossary.test.ts` asserts against the repository itself: every
 * {@link EstimatorGlossaryEntry.module} exists, every
 * {@link EstimatorGlossaryEntry.entryPoint} is really exported by it, every
 * {@link EstimatorGlossaryEntry.measuredIn} exists, and **every measured
 * number quoted below appears verbatim in the test that measured it**. A row
 * that drifts from the code is then a test failure rather than a plausible
 * paragraph. That is the discipline P6.29 established for its guided studies,
 * applied to guidance rather than to exercises.
 *
 * ## What the numbers in {@link EstimatorGlossaryEntry.measured} are, and are not
 *
 * They are quotations, with attribution, of figures the cited validation test
 * recorded when it was written. They are **not fresh measurements taken by
 * this module**, they are not benchmarks, and they are not promises about a
 * different observable — every one of them is the value on the specific
 * problem its own test constructs, and three of the five rows exist mainly to
 * say where the method stops working. Read them as evidence that the method
 * does something on a problem of a stated shape, never as a factor to expect.
 */

/** The five sampling and variance-reduction methods phase 6 built. */
export type EstimatorId =
  | "monte-carlo"
  | "latin-hypercube"
  | "quasi-monte-carlo"
  | "control-variate"
  | "importance-sampling";

/** One row of the when-to-use table. */
export interface EstimatorGlossaryEntry {
  /** Stable key; the dashboard and the ADR both address rows by this. */
  readonly id: EstimatorId;
  /** Full name, spelled out. */
  readonly name: string;
  /** The abbreviation the roadmap and the blueprint use. */
  readonly abbreviation: string;
  /** The roadmap task that built it, for the history. */
  readonly task: string;
  /** Repository-relative path of the implementing module. */
  readonly module: string;
  /** The exported symbol a caller starts from. */
  readonly entryPoint: string;
  /** The quantity it estimates — the rows do not all estimate the same thing. */
  readonly estimates: string;
  /** How the error behaves as the replicate count grows. */
  readonly errorBehaviour: string;
  /** The condition under which it is the right tool. */
  readonly useWhen: string;
  /** The condition under which it is the wrong tool, or buys nothing. */
  readonly avoidWhen: string;
  /** A measured figure, quoted verbatim from {@link measuredIn}. */
  readonly measured: string;
  /** Repository-relative path of the test that measured it. */
  readonly measuredIn: string;
}

/**
 * The when-to-use table, in the order ADR-019 prints it: the baseline first,
 * then the two that change *how the inputs are drawn*, then the two that
 * change *what is computed from them*. That grouping is the table's actual
 * content — LHS and QMC are alternatives to each other and CV and IS are not
 * alternatives to anything, they are corrections applied on top of a draw.
 */
export const ESTIMATOR_GLOSSARY: readonly EstimatorGlossaryEntry[] = [
  {
    id: "monte-carlo",
    name: "Plain Monte Carlo",
    abbreviation: "MC",
    task: "P6.03",
    module: "packages/engine/src/replicate-generator.ts",
    entryPoint: "generateReplicate",
    estimates: "Any expectation, quantile or probability over the input distribution.",
    errorBehaviour:
      "Standard error falls as N^(-1/2), independently of the observable's smoothness or the number of uncertain parameters.",
    useWhen:
      "Always, first. It is the baseline every other row is measured against, the only one with no precondition on the observable, and the one whose error bar means what it says without argument.",
    avoidWhen:
      "Never avoid it — replace it only when a row below states a precondition your problem actually meets. A rare event is the one case where it is not merely slow but unusable: see importance sampling.",
    measured:
      "measured MC slope on a smooth two-parameter problem sits between -0.65 and -0.35, i.e. the N^(-1/2) rate, against Sobol's -0.85 or steeper",
    measuredIn: "packages/analysis/src/sobol-convergence.test.ts",
  },
  {
    id: "latin-hypercube",
    name: "Latin hypercube sampling",
    abbreviation: "LHS",
    task: "P6.14",
    module: "packages/engine/src/latin-hypercube.ts",
    entryPoint: "latinHypercubeReplicates",
    estimates:
      "The same quantities as plain MC; it changes only how the uniforms are drawn, so every downstream statistic is unchanged in meaning.",
    errorBehaviour:
      "Still N^(-1/2) asymptotically, with the constant cut by however much of the variance sits in one-dimensional main effects.",
    useWhen:
      "The observable is smooth and mostly additive in the drawn parameters, and N is fixed in advance. Stratifying each margin removes the main-effect variance by construction.",
    avoidWhen:
      "The variance is carried by interactions rather than main effects — there is nothing for a one-dimensional stratification to remove — or N is not known up front, since the design is a joint construction over all N replicates.",
    measured:
      "SE 6.037 m plain against 0.410 m stratified, a ratio of 0.068 on mean range at N = 64; on a purely interactive observable the same comparison gives a ratio of 1.10 — no improvement at all, and in fact a slight cost",
    measuredIn: "packages/analysis/src/latin-hypercube-variance-reduction.test.ts",
  },
  {
    id: "quasi-monte-carlo",
    name: "Quasi-Monte Carlo (scrambled Sobol' sequence)",
    abbreviation: "QMC",
    task: "P6.15",
    module: "packages/engine/src/sobol.ts",
    entryPoint: "sobolReplicates",
    estimates:
      "The same quantities as plain MC. The scramble is what keeps it an estimator with a distribution rather than a fixed quadrature rule, so intervals remain formable.",
    errorBehaviour:
      "Error falls at roughly N^(-1) on an integrand of bounded variation — a whole order better than MC — degrading toward N^(-1/2) as the integrand's variation grows.",
    useWhen:
      "The observable is smooth in the drawn parameters and the dimension is modest. This is the largest win available on a well-behaved integrand.",
    avoidWhen:
      "The observable is discontinuous — a hit indicator or any thresholded quantity has unbounded variation in the Hardy-Krause sense and gives the rate straight back. This is the honest caveat, not a corner case: the dashboard's own hit probability is exactly such an observable.",
    measured:
      "Sobol' slope steeper than -0.85 where MC manages -0.65 to -0.35, and error below MC/8 at the largest size measured; the rate is given up on a discontinuous observable, which the suite asserts deliberately",
    measuredIn: "packages/analysis/src/sobol-convergence.test.ts",
  },
  {
    id: "control-variate",
    name: "Control variates",
    abbreviation: "CV",
    task: "P6.13",
    module: "packages/analysis/src/control-variate.ts",
    entryPoint: "controlVariateMean",
    estimates:
      "A mean, and only a mean. It is a post-processing step on replicates already drawn, not a way of drawing them.",
    errorBehaviour:
      "Variance is multiplied by 1 - rho^2, where rho is the correlation between the control and the observable. The rate stays N^(-1/2); the constant moves.",
    useWhen:
      "A cheap quantity is strongly correlated with the expensive one AND its exact mean is known in closed form. All three clauses are required. The drag-free analytic range is the worked example: cheap, correlated, exact mean.",
    avoidWhen:
      "Correlation is weak — at rho = 0.3 it removes 9% of the variance and is not worth the plumbing — or the control's mean is only estimated, in which case the correction is not the identity it relies on.",
    measured:
      "variance ratio 0.00115, a 99.9% cut, from a mean rho of 0.99952 on the drag-free-range control; on a deliberately poor control the same study measures 0.994 — no win, and no loss either, because the estimated coefficient falls back to the plain mean",
    measuredIn: "packages/analysis/src/control-variate-variance-reduction.test.ts",
  },
  {
    id: "importance-sampling",
    name: "Importance sampling",
    abbreviation: "IS",
    task: "P6.23",
    module: "packages/analysis/src/importance-sampling.ts",
    entryPoint: "importanceSamplingProbability",
    estimates:
      "A probability, and specifically a small one. Draws come from a tilted proposal and are reweighted by a likelihood ratio.",
    errorBehaviour:
      "Unbiased for any admissible proposal; the proposal choice moves variance alone. A good proposal turns a rare event into roughly a coin flip under the proposal.",
    useWhen:
      "The event is rare enough that counting hits is hopeless. Brute force needs a sample size scaling as 1/p for fixed relative accuracy, so this is a change of asymptotics rather than a constant-factor saving.",
    avoidWhen:
      "The event is common — there is nothing to gain on a coin flip — or no defensible proposal exists. A bad proposal fails silently: it returns a plausible number computed from one or two draws, with a small standard error computed from that same degenerate sample. Read the three diagnostics, not just the estimate.",
    measured:
      "at p = 1.59109e-4, brute force needs 6.28e5 draws for 10% relative error, 31x the entire brute-force budget of its own test — and that is at a merely 3.6-sigma event",
    measuredIn: "packages/analysis/src/importance-sampling-variance-reduction.test.ts",
  },
];

/** Repository-relative path of the ADR this table is the machine-readable half of. */
export const ESTIMATOR_GLOSSARY_ADR = "docs/adr/ADR-019-estimator-glossary.md";

/** The row for `id`, or `undefined` for an id with no row. */
export function estimatorGlossaryEntry(id: string): EstimatorGlossaryEntry | undefined {
  return ESTIMATOR_GLOSSARY.find((entry) => entry.id === id);
}
