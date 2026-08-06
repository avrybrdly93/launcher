import type { ExhibitId } from "@ballista/engine";

/**
 * The hash-route table `main.tsx` dispatches on, extracted from it (P4.36)
 * so it can be asserted against without importing `main.tsx` -- that module
 * bootstraps the app at import time (`document.getElementById`, `render`,
 * a `hashchange` listener), which a test has no business triggering.
 *
 * `main.tsx` remains the only place that renders; this module holds only
 * the route *identity* data. Route components are referenced by `main.tsx`
 * rather than imported here, keeping this a leaf module with no component
 * graph behind it.
 */

/** Every non-default route hash `main.tsx` handles, in its own switch order. */
export const ROUTE_HASHES = [
  "#/solver-lab",
  "#/convergence-study",
  "#/stability-explorer",
  "#/energy-drift",
  "#/terrain-editor",
  "#/neglected-effects",
  "#/density-altitude",
  "#/model-registry",
] as const;

/** One of {@link ROUTE_HASHES}. */
export type RouteHash = (typeof ROUTE_HASHES)[number];

/**
 * Where a curated scenario's `exhibit` id points. `"simulator"` maps to the
 * empty hash: `main.tsx`'s `default` branch renders `<App />`, the default
 * simulator route, for any hash it does not recognise -- including none.
 */
export const EXHIBIT_ROUTE_HASHES: Readonly<Record<ExhibitId, "" | RouteHash>> = {
  simulator: "",
  "solver-lab": "#/solver-lab",
  "convergence-study": "#/convergence-study",
  "stability-explorer": "#/stability-explorer",
  "energy-drift": "#/energy-drift",
  "terrain-editor": "#/terrain-editor",
  "neglected-effects": "#/neglected-effects",
  "density-altitude": "#/density-altitude",
  "model-registry": "#/model-registry",
};

/** The href a preset browser's "open the exhibit" link uses for `exhibit`. */
export function exhibitHref(exhibit: ExhibitId): string {
  return EXHIBIT_ROUTE_HASHES[exhibit] || "#/";
}
