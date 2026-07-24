/**
 * Compare legend (§5.4 `compareStore`; §6.1 "TrajectoryLayer[×N] committed +
 * pinned trajectories"; P3.25). A pure rendering of
 * `compareLegend(compareStore.getState())` (`@ballista/runtime`) -- one row
 * per pinned trajectory, its assigned categorical color as a swatch next to
 * its label, in pin order. `onUnpin` is optional: a read-only overlay (e.g.
 * a static comparison screenshot) can render the legend with nothing to
 * unpin.
 */

import type { CompareLegendEntry } from "@ballista/runtime";

export interface CompareLegendProps {
  readonly entries: readonly CompareLegendEntry[];
  readonly onUnpin?: (id: string) => void;
}

export function CompareLegend({ entries, onUnpin }: CompareLegendProps) {
  if (entries.length === 0) return null;

  return (
    <ul class="compare-legend" data-testid="compare-legend">
      {entries.map((entry) => (
        <li
          class="compare-legend-row"
          key={entry.id}
          data-testid={`compare-legend-row-${entry.id}`}
        >
          <span
            class="compare-legend-swatch"
            data-testid={`compare-legend-swatch-${entry.id}`}
            style={{ backgroundColor: entry.color }}
          />
          <span class="compare-legend-label">{entry.label}</span>
          {onUnpin !== undefined && (
            <button
              type="button"
              class="compare-legend-unpin"
              data-testid={`compare-legend-unpin-${entry.id}`}
              onClick={() => onUnpin(entry.id)}
            >
              &times;
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
