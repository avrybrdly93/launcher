/**
 * Density Altitude exercise route (§6.3 "distinct route"; P4.29). Like
 * Neglected Effects, this exhibit has no scenario/preset picker -- it is
 * always the soccer-ball preset's sea-level-vs-2000m shot comparison -- so
 * the route just runs `computeDensityAltitudeComparison` once and feeds the
 * presentational `DensityAltitudePage` (`@ballista/ui`). `main.tsx` mounts
 * this in place of `App` whenever `location.hash === "#/density-altitude"`.
 */

import { computeDensityAltitudeComparison } from "@ballista/runtime";
import { DensityAltitudePage } from "@ballista/ui";
import { useMemo } from "preact/hooks";
import "./solver-lab-route.css";

export function DensityAltitudeRoute() {
  const result = useMemo(() => computeDensityAltitudeComparison(), []);

  return (
    <div class="solver-lab-route" data-testid="density-altitude-route">
      <a href="#/" class="solver-lab-route-back" data-testid="density-altitude-back-link">
        &larr; Back to simulator
      </a>
      <DensityAltitudePage result={result} />
    </div>
  );
}
