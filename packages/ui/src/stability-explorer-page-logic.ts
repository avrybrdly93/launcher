/**
 * Stability-explorer page's non-rendering logic (§7 P3.43): the step-size
 * text-input <-> numeric conversion, `z = h*lambda` scaling of the sampled
 * eigenvalues, the per-order default plot window, and eigenvalue display
 * formatting -- split out from `stability-explorer-page.tsx` per this
 * package's established `<feature>-page-logic.ts` convention.
 */

import type { EigenvalueSample } from "@ballista/runtime";
import type { Complex } from "@ballista/solverkit";

/** The step size a fresh page starts with -- large enough that explicit Euler's `h*lambda` visibly sits outside its own disk for a typical drag scenario, the point of the exhibit. */
export const DEFAULT_STABILITY_H = 0.05;

/** Renders a step size as the text a `<input>` shows/edits. */
export function formatH(h: number): string {
  return String(h);
}

/** Parses a step-size text field; `undefined` for anything that isn't a positive finite number, so a still-being-typed field (e.g. a trailing ".") doesn't recompute the plot against garbage. */
export function parseH(text: string): number | undefined {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Scales every sampled trajectory eigenvalue by `h`, flattening both
 * velocity-block branches (`lambda[0]`, `lambda[1]`) of every sample into a
 * single `z = h*lambda` point list -- exactly what {@link
 * buildStabilityRegionFigure} (`@ballista/viz`) overlays on the `|R(z)|=1`
 * contour. Kept out of the page component so "does z track h correctly" is
 * unit-testable without a DOM.
 */
export function scaleEigenvaluesByH(samples: readonly EigenvalueSample[], h: number): Complex[] {
  const points: Complex[] = [];
  for (const sample of samples) {
    for (const lambda of sample.lambda) {
      points.push({ re: h * lambda.re, im: h * lambda.im });
    }
  }
  return points;
}

/**
 * A plot window sized to comfortably fit the given method's `|R(z)|=1`
 * region (eq. 4.11): RK4's region reaches roughly -2.785 on the real axis
 * and +-2*sqrt(2) on the imaginary axis, both well past Euler's/RK2's
 * smaller regions, so a fixed one-size-fits-all window would either clip
 * RK4 or waste most of its area on Euler.
 */
export function defaultStabilityRegionRange(order: number): {
  readonly reRange: readonly [number, number];
  readonly imRange: readonly [number, number];
} {
  if (order >= 4) return { reRange: [-3.4, 0.6], imRange: [-3.2, 3.2] };
  if (order === 2) return { reRange: [-2.6, 0.6], imRange: [-2.2, 2.2] };
  return { reRange: [-2.3, 0.6], imRange: [-1.6, 1.6] };
}

/** Renders a complex number for a readout, e.g. `-0.32 + 0.15i` / `-0.32 - 0.15i`. */
export function formatComplex(z: Complex): string {
  const re = z.re.toFixed(3);
  const sign = z.im < 0 ? "-" : "+";
  const im = Math.abs(z.im).toFixed(3);
  return `${re} ${sign} ${im}i`;
}
