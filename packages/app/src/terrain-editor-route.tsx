/**
 * Terrain-editor route (§7 P4.14; §6.3 "distinct route"): owns the
 * control-point state and recomputes `solveTerrainEditorLaunch` on every
 * change (drag or numeric edit), feeding the presentational
 * `TerrainEditorPage` (`@ballista/ui`) -- mirrors
 * `stability-explorer-route.tsx`'s split between live state (here) and
 * rendering (there), which is what makes "edited terrain re-solves live"
 * (this task's validation criterion) true: `controlPoints` is a `useState`
 * and `result` a `useMemo` keyed on it, so every drag/input edit
 * synchronously re-runs the solve on the next render. Export/import go
 * through `serializeTerrainControlPoints`/`deserializeTerrainControlPoints`
 * (`@ballista/engine`) for the "serialization round-trip" half of that
 * criterion.
 */
import {
  deserializeTerrainControlPoints,
  serializeTerrainControlPoints,
  type TerrainControlPoint,
} from "@ballista/engine";
import { solveTerrainEditorLaunch } from "@ballista/runtime";
import { TerrainEditorPage } from "@ballista/ui";
import { useMemo, useState } from "preact/hooks";
import "./solver-lab-route.css";

/** A small hill: enough curvature to show PCHIP's shape-preserving interpolation isn't just straight segments between points. */
const DEFAULT_CONTROL_POINTS: readonly TerrainControlPoint[] = [
  { x: 0, y: 0 },
  { x: 30, y: 8 },
  { x: 60, y: 3 },
  { x: 100, y: 0 },
];

/** The minimum {@link PiecewisePchipTerrain} (and thus `solveTerrainEditorLaunch`) will accept -- checked before committing an import so a too-short payload surfaces as an import error rather than crashing the next render's re-solve. */
const MIN_CONTROL_POINTS = 2;

export function TerrainEditorRoute() {
  const [controlPoints, setControlPoints] =
    useState<readonly TerrainControlPoint[]>(DEFAULT_CONTROL_POINTS);
  const [exportedJson, setExportedJson] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const result = useMemo(() => solveTerrainEditorLaunch(controlPoints), [controlPoints]);

  function handleExport(): void {
    setExportedJson(serializeTerrainControlPoints(controlPoints));
  }

  function handleImport(): void {
    try {
      const points = deserializeTerrainControlPoints(importText);
      if (!Array.isArray(points) || points.length < MIN_CONTROL_POINTS) {
        throw new Error(`A terrain needs at least ${MIN_CONTROL_POINTS} control points.`);
      }
      setControlPoints(points);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div class="solver-lab-route" data-testid="terrain-editor-route">
      <a href="#/" class="solver-lab-route-back" data-testid="terrain-editor-back-link">
        &larr; Back to simulator
      </a>
      <TerrainEditorPage
        controlPoints={controlPoints}
        onControlPointsChange={setControlPoints}
        result={result}
        exportedJson={exportedJson}
        onExport={handleExport}
        importText={importText}
        onImportTextChange={setImportText}
        onImport={handleImport}
        importError={importError}
      />
    </div>
  );
}
