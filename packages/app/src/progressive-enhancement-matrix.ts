/**
 * The progressive-enhancement suppression matrix (P7.29): which optional
 * platform features the app is required to survive the absence of, how each one
 * is removed from a page before any application code runs, and how a test
 * proves the removal actually took.
 *
 * **This module holds the matrix; it does not drive a browser.** That split is
 * the point. `progressive-enhancement.e2e.test.ts` is a Playwright suite and
 * therefore skips wherever no browser binary exists, so if the matrix itself
 * lived inside it, "which combinations are covered" would be a question only a
 * machine with Chromium could answer. Here the enumeration is a property of the
 * code — 2³ subsets, each exactly once — and is asserted without a browser, in
 * `progressive-enhancement-matrix.test.ts`. The browser suite then answers the
 * different question the criterion actually asks: does the app still work in
 * each of them.
 *
 * **Every suppression carries its own probe, and that is not redundancy.** A
 * suppression script that silently failed — a non-configurable global, a
 * property that lives on a prototype rather than the instance, a browser that
 * renamed something — would leave a matrix that runs eight green combinations
 * while testing one. {@link FeatureSuppression.absenceProbe} is the expression
 * the suite evaluates *in the page* to confirm the feature is gone before it
 * asserts anything about the app. The guard has to be shown to bite.
 *
 * **What this is not.** It does not claim a feature was present to begin with.
 * A headless container may expose no `navigator.gpu` at all, in which case the
 * `webgpu` suppression is a no-op and its probe passes for a reason the script
 * had nothing to do with. That is honest and is what a *progressive
 * enhancement* matrix is for: the requirement is that the app works when the
 * feature is missing, not that this suite can manufacture a machine on which it
 * is present. Establishing behaviour on a machine that *has* a GPU is P7.20's
 * territory and needs hardware.
 */

/** A platform feature the app must degrade gracefully without. */
export type SuppressibleFeatureId = "wasm" | "webgpu" | "sharedArrayBuffer";

/** How one feature is removed from a page, and how its absence is confirmed. */
export interface FeatureSuppression {
  readonly id: SuppressibleFeatureId;
  /** Prose for a test name, so a failing combination is readable in the report. */
  readonly label: string;
  /**
   * Script evaluated in the page before any application script runs
   * (Playwright's `addInitScript`), removing the feature.
   *
   * Written to be idempotent and to fail loudly rather than quietly: each one
   * uses `Object.defineProperty` with `configurable: true` rather than `delete`
   * where the global is an accessor on a prototype, because `delete
   * navigator.gpu` removes nothing when `gpu` is inherited — the exact silent
   * no-op {@link absenceProbe} exists to catch.
   */
  readonly initScript: string;
  /**
   * An expression evaluated in the page that is `true` exactly when the feature
   * is unreachable. Asserted by the suite *before* it asserts anything about
   * the app.
   */
  readonly absenceProbe: string;
}

/**
 * The three features in the criterion's own words — "no-WASM, no-GPU, no-SAB" —
 * in a fixed order, so a combination's name is stable across runs.
 */
export const SUPPRESSIBLE_FEATURES: readonly FeatureSuppression[] = [
  {
    id: "wasm",
    label: "no-WASM",
    // `WebAssembly` is a configurable own property of the global object in V8,
    // so defineProperty-to-undefined and delete are equivalent here; the former
    // is used for symmetry with the other two and because it survives a second
    // application without throwing.
    initScript: `Object.defineProperty(globalThis, "WebAssembly", {
      configurable: true,
      writable: true,
      value: undefined,
    });`,
    absenceProbe: `typeof globalThis.WebAssembly === "undefined"`,
  },
  {
    id: "webgpu",
    label: "no-GPU",
    // `gpu` is an accessor on `Navigator.prototype`, not an own property of the
    // `navigator` instance. Defining an own property shadows the inherited
    // accessor; `delete navigator.gpu` would return true and change nothing.
    initScript: `Object.defineProperty(navigator, "gpu", {
      configurable: true,
      get() {
        return undefined;
      },
    });`,
    absenceProbe: `navigator.gpu === undefined`,
  },
  {
    id: "sharedArrayBuffer",
    label: "no-SAB",
    // `crossOriginIsolated` goes with it: a page that reports isolation while
    // `SharedArrayBuffer` is absent describes a browser that does not exist, and
    // any code branching on isolation rather than on the constructor would take
    // the wrong path for a reason this matrix invented.
    initScript: `Object.defineProperty(globalThis, "SharedArrayBuffer", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      configurable: true,
      get() {
        return false;
      },
    });`,
    absenceProbe: `typeof globalThis.SharedArrayBuffer === "undefined" && globalThis.crossOriginIsolated === false`,
  },
];

/** One cell of the matrix: the set of features suppressed for a single page. */
export interface SuppressionCombination {
  /** The suppressed features, in {@link SUPPRESSIBLE_FEATURES} order. */
  readonly features: readonly FeatureSuppression[];
  /**
   * A stable name for the cell: the suppressed labels joined, or `"baseline"`
   * for the empty set.
   *
   * The empty set is a deliberate member of the matrix rather than a separate
   * smoke test. It is the control: if `baseline` fails alongside the other
   * seven, the suite is reporting a broken app, not a broken fallback path, and
   * a matrix without its control cannot tell those apart.
   */
  readonly name: string;
}

/**
 * Every subset of {@link SUPPRESSIBLE_FEATURES}, including the empty one.
 *
 * Enumerated by bitmask over the feature list rather than written out, so the
 * matrix cannot fall behind the feature list: adding a fourth feature doubles
 * the cells automatically and the completeness test below keeps counting.
 */
export function enumerateSuppressionCombinations(
  features: readonly FeatureSuppression[] = SUPPRESSIBLE_FEATURES,
): readonly SuppressionCombination[] {
  const combinations: SuppressionCombination[] = [];
  for (let mask = 0; mask < 1 << features.length; mask += 1) {
    const selected = features.filter((_, index) => (mask & (1 << index)) !== 0);
    combinations.push({
      features: selected,
      name: selected.length === 0 ? "baseline" : selected.map((f) => f.label).join(" + "),
    });
  }
  return combinations;
}

/**
 * The single init script for a combination: every selected feature's removal,
 * concatenated in matrix order.
 *
 * Returns `""` for the empty set, which Playwright's `addInitScript` accepts
 * and which the suite still installs — so the baseline cell goes through the
 * identical code path as the other seven rather than a shorter one.
 */
export function suppressionInitScript(combination: SuppressionCombination): string {
  return combination.features.map((feature) => feature.initScript).join("\n");
}
