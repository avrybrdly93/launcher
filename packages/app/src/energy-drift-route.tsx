/**
 * Energy-drift dashboard route (§6.3 "distinct route"; P3.44 shell,
 * blueprint §4.8 "flagship comparison exhibit"). Unlike Solver Lab /
 * Convergence Study, this exhibit has no scenario/method picker -- it is
 * always the gravity-only lofted shot at a fixed rhs-evaluation budget
 * (§4.8), so the route just runs `runEnergyDriftStudy` once and feeds the
 * presentational `EnergyDriftPage` (`@ballista/ui`). `main.tsx` mounts this
 * in place of `App` whenever `location.hash === "#/energy-drift"`.
 */

import { runEnergyDriftStudy } from "@ballista/runtime";
import { EnergyDriftPage } from "@ballista/ui";
import { useMemo } from "preact/hooks";
import "./solver-lab-route.css";

export function EnergyDriftRoute() {
  const study = useMemo(() => runEnergyDriftStudy(), []);

  return (
    <div class="solver-lab-route" data-testid="energy-drift-route">
      <a href="#/" class="solver-lab-route-back" data-testid="energy-drift-back-link">
        &larr; Back to simulator
      </a>
      <EnergyDriftPage study={study} />
    </div>
  );
}
