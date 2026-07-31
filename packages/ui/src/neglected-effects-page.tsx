/**
 * Neglected Effects exercise page (§7 P4.20, blueprint §3.4 + §5.5 worked
 * example 1: "how big are the effects we ignore?"). Buoyancy is a real,
 * small, toggleable force -- already live in the main simulator's Forces
 * panel (auto-UI, `forces-panel-logic.ts`, no bespoke wiring needed per the
 * worked example's "no other edits" claim) -- so this page's job is purely
 * to answer "how big," for a representative preset, and to document the one
 * effect that has *no* toggle at all: added mass. Purely presentational,
 * mirroring `EnergyDriftPage`: the caller (the app-level route) owns
 * computing `result` (`computeNeglectedEffects`, `@ballista/runtime`).
 */
import type { NeglectedEffectsResult } from "@ballista/runtime";
import { formatRatioAsPercent } from "./neglected-effects-page-logic.js";

export interface NeglectedEffectsPageProps {
  readonly result: NeglectedEffectsResult;
}

export function NeglectedEffectsPage({ result }: NeglectedEffectsPageProps) {
  return (
    <div class="neglected-effects-page" data-testid="neglected-effects-page">
      <h1>Neglected Effects</h1>
      <p class="neglected-effects-page-summary" data-testid="neglected-effects-summary">
        Every model draws a line between "included" and "ignored." Buoyancy is on the included side,
        but only barely -- this page answers exactly how small it is. Added mass sits on the ignored
        side, and stays there.
      </p>

      <h2>Buoyancy: included, and small</h2>
      <p>
        F<sub>b</sub> = ρ·V·g acts upward on every projectile, opposing gravity, and is a real,
        toggleable force in the main simulator&apos;s Forces panel. For {result.presetName}:
      </p>
      <table class="neglected-effects-page-table" data-testid="neglected-effects-table">
        <tbody>
          <tr>
            <th scope="row">Mass</th>
            <td data-testid="neglected-effects-mass">{result.mass.toPrecision(3)} kg</td>
          </tr>
          <tr>
            <th scope="row">Radius</th>
            <td data-testid="neglected-effects-radius">{result.radius.toPrecision(3)} m</td>
          </tr>
          <tr>
            <th scope="row">Volume</th>
            <td data-testid="neglected-effects-volume">{result.volume.toPrecision(3)} m³</td>
          </tr>
          <tr>
            <th scope="row">Sea-level air density (ISA)</th>
            <td data-testid="neglected-effects-rho">{result.rhoAir.toPrecision(4)} kg/m³</td>
          </tr>
          <tr>
            <th scope="row">|F_b| / |F_g|</th>
            <td data-testid="neglected-effects-ratio">
              {formatRatioAsPercent(result.buoyancyToWeightRatio)}
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Added mass: deliberately not modeled</h2>
      <p>
        Added (or "virtual") mass -- the extra apparent inertia from air the projectile must push
        aside as it accelerates -- is not simulated here, at all, for any preset. It only becomes a
        significant fraction of a projectile&apos;s own mass when the projectile&apos;s density is
        close to the surrounding fluid&apos;s (ρ<sub>body</sub> ~ ρ<sub>air</sub>). Every preset in
        the projectile library is far denser than air, so the effect would be immeasurably small
        even if implemented -- unlike buoyancy, it fails the "is this worth a toggle" test outright,
        which is why it has documentation instead of a `ForceModel`.
      </p>
    </div>
  );
}
