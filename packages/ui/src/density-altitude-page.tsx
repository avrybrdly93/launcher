/**
 * Density-Altitude exercise page (§7 P4.29): "same shot, sea level vs.
 * 2000 m -- how much farther does it go?" Purely presentational, mirroring
 * `NeglectedEffectsPage` (P4.20): the caller (the app-level route) owns
 * computing `result` (`computeDensityAltitudeComparison`, `@ballista/runtime`).
 */
import type { DensityAltitudeResult } from "@ballista/runtime";
import { formatDensity, formatRangeIncrease } from "./density-altitude-page-logic.js";
import { formatMeters } from "./terrain-editor-page-logic.js";

export interface DensityAltitudePageProps {
  readonly result: DensityAltitudeResult;
}

export function DensityAltitudePage({ result }: DensityAltitudePageProps) {
  return (
    <div class="density-altitude-page" data-testid="density-altitude-page">
      <h1>Density Altitude</h1>
      <p class="density-altitude-page-summary" data-testid="density-altitude-summary">
        Air gets thinner as you climb, which means less quadratic drag on the way down. This page
        fires the exact same {result.presetName} shot -- {result.muzzleSpeed} m/s at{" "}
        {result.elevationDeg}&deg; -- once from sea level and once from 2000 m, and measures how
        much farther the thinner air lets it carry.
      </p>

      <table class="density-altitude-page-table" data-testid="density-altitude-table">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Altitude</th>
            <th scope="col">Air density</th>
            <th scope="col">Range</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Sea level</th>
            <td data-testid="density-altitude-sea-level-altitude">
              {formatMeters(result.seaLevel.altitude)}
            </td>
            <td data-testid="density-altitude-sea-level-rho">
              {formatDensity(result.seaLevel.rhoAir)}
            </td>
            <td data-testid="density-altitude-sea-level-range">
              {formatMeters(result.seaLevel.range)}
            </td>
          </tr>
          <tr>
            <th scope="row">2000 m ASL</th>
            <td data-testid="density-altitude-high-altitude-altitude">
              {formatMeters(result.highAltitude.altitude)}
            </td>
            <td data-testid="density-altitude-high-altitude-rho">
              {formatDensity(result.highAltitude.rhoAir)}
            </td>
            <td data-testid="density-altitude-high-altitude-range">
              {formatMeters(result.highAltitude.range)}
            </td>
          </tr>
        </tbody>
      </table>

      <p class="density-altitude-page-increase">
        Range increase at 2000 m:{" "}
        <strong data-testid="density-altitude-increase">
          {formatRangeIncrease(result.rangeIncrease, result.rangeIncreasePercent)}
        </strong>
      </p>
    </div>
  );
}
