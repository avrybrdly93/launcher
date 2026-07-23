/**
 * Forces panel (§6.3 panel group 4: "per-force enable toggles with live
 * badge showing current magnitude at playhead"; P3.22). One row per
 * `FORCE_TOGGLES` entry: a checkbox committing an updated `forceIds` array
 * via `toggleForceId`, and a badge reading straight from `glyphSet`
 * (`forceGlyphsAtPlayhead`, `@ballista/viz`) -- the same live per-force
 * magnitudes the World layer's force glyphs draw, so the badge and the
 * on-canvas arrow can never disagree.
 */

import type { ForceGlyphSet } from "@ballista/viz";
import { badgeMagnitude, FORCE_TOGGLES, toggleForceId } from "./forces-panel-logic.js";

export interface ForcesPanelProps {
  readonly forceIds: readonly string[];
  /** The current playhead's per-force magnitudes, or `undefined` before any result exists (badges render blank). */
  readonly glyphSet: ForceGlyphSet | undefined;
  readonly onChange: (nextForceIds: readonly string[]) => void;
}

function formatMagnitude(magnitude: number | undefined): string {
  return magnitude === undefined ? "—" : `${magnitude.toPrecision(3)} N`;
}

export function ForcesPanel({ forceIds, glyphSet, onChange }: ForcesPanelProps) {
  return (
    <div class="forces-panel" data-testid="forces-panel">
      {FORCE_TOGGLES.map(({ id, label }) => {
        const enabled = forceIds.includes(id);
        return (
          <div class="forces-panel-row" key={id} data-testid={`force-row-${id}`}>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                data-testid={`force-toggle-${id}`}
                onChange={() => onChange(toggleForceId(forceIds, id))}
              />
              {label}
            </label>
            <span class="forces-panel-badge" data-testid={`force-badge-${id}`}>
              {formatMagnitude(badgeMagnitude(glyphSet, id))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
