/**
 * Neglected Effects exercise route (§6.3 "distinct route"; P4.20, blueprint
 * §5.5 worked example 1). Like Energy Drift, this exhibit has no
 * scenario/preset picker -- it is always the soccer-ball preset's buoyancy
 * ratio (§3.4's own quoted example), so the route just runs
 * `computeNeglectedEffects` once and feeds the presentational
 * `NeglectedEffectsPage` (`@ballista/ui`). `main.tsx` mounts this in place of
 * `App` whenever `location.hash === "#/neglected-effects"`.
 */

import { computeNeglectedEffects } from "@ballista/runtime";
import { NeglectedEffectsPage } from "@ballista/ui";
import { useMemo } from "preact/hooks";
import "./solver-lab-route.css";

export function NeglectedEffectsRoute() {
  const result = useMemo(() => computeNeglectedEffects(), []);

  return (
    <div class="solver-lab-route" data-testid="neglected-effects-route">
      <a href="#/" class="solver-lab-route-back" data-testid="neglected-effects-back-link">
        &larr; Back to simulator
      </a>
      <NeglectedEffectsPage result={result} />
    </div>
  );
}
