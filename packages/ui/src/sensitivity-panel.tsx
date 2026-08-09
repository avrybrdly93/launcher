/**
 * Sensitivity-channels panel (P5.11): live `dR/dθ`, `dR/dv₀` and `dR/dC_d`
 * readouts for the committed scenario, each read off P5.10's tangent-linear
 * solve.
 *
 * A row shows a number or it shows why it has none — see
 * `sensitivity-panel-logic.ts`'s `dragUnavailableReason` for why a blank `C_d`
 * row is the honest rendering of a scenario with drag switched off, and a
 * printed `0.00 m` is not.
 */

import {
  type SensitivityReadout,
  SENSITIVITY_CHANNELS,
  formatSensitivity,
} from "./sensitivity-panel-logic.js";

export interface SensitivityPanelProps {
  /** The readout for the committed scenario, or `undefined` before one exists. */
  readonly readout: SensitivityReadout | undefined;
}

export function SensitivityPanel({ readout }: SensitivityPanelProps) {
  return (
    <div class="sensitivity-panel" data-testid="sensitivity-panel">
      <h2 class="sensitivity-panel__title">Range sensitivities</h2>

      {readout?.failure !== undefined && readout.failure !== null && (
        <p class="sensitivity-panel__failure" data-testid="sensitivity-failure">
          {readout.failure}
        </p>
      )}

      {SENSITIVITY_CHANNELS.map((channel) => {
        const row = readout?.channels.find((entry) => entry.id === channel.id);
        return (
          <div
            class="sensitivity-panel__row"
            key={channel.id}
            data-testid={`sensitivity-row-${channel.id}`}
          >
            <span class="sensitivity-panel__label" title={channel.description}>
              {channel.label}
            </span>
            <span
              class="sensitivity-panel__value"
              data-testid={`sensitivity-value-${channel.id}`}
              title={row?.status === "unavailable" ? row.reason : channel.description}
            >
              {row === undefined ? "—" : formatSensitivity(row, channel)}
            </span>
          </div>
        );
      })}

      {readout?.stepperNote !== undefined && readout.stepperNote !== null && (
        <p class="sensitivity-panel__note" data-testid="sensitivity-stepper-note">
          {readout.stepperNote}
        </p>
      )}
    </div>
  );
}
