/**
 * Terrain editor page (§7 P4.14, blueprint §6.1 scene-graph `TerrainLayer`):
 * renders the terrain's h(x) profile and the freshly re-solved trajectory
 * over it as an SVG, with each control point draggable directly on the
 * plot. Every point is *also* editable via a synced x/y numeric-input row
 * (the fully keyboard-operable path -- dragging an SVG circle has no
 * keyboard equivalent, the same reason `NumericControlRow` always pairs a
 * slider with a number input, P3.19). Both paths funnel through the same
 * `onControlPointsChange`, so the caller's live re-solve
 * (`solveTerrainEditorLaunch`, `@ballista/runtime`) sees identical input
 * regardless of which one produced it -- purely presentational, mirroring
 * `StabilityExplorerPage`'s split: the caller (the app-level route) owns
 * the control-point state and recomputes `result` on change.
 */
import type { TerrainControlPoint } from "@ballista/engine";
import type { TerrainEditorResult } from "@ballista/runtime";
import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import {
  computeViewDomain,
  dataXToScreenX,
  dataYToScreenY,
  formatMeters,
  profileToSvgPolylinePoints,
  sampleTerrainProfile,
  screenXToDataX,
  screenYToDataY,
} from "./terrain-editor-page-logic.js";

const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 400;
const CONTROL_POINT_RADIUS = 7;
const PROFILE_SAMPLE_COUNT = 150;
/** New points append this far past the current rightmost point (§ "Add point"). */
const NEW_POINT_X_OFFSET = 10;

export interface TerrainEditorPageProps {
  readonly controlPoints: readonly TerrainControlPoint[];
  readonly onControlPointsChange: (points: readonly TerrainControlPoint[]) => void;
  readonly result: TerrainEditorResult;
  readonly exportedJson: string | null;
  readonly onExport: () => void;
  readonly importText: string;
  readonly onImportTextChange: (text: string) => void;
  readonly onImport: () => void;
  readonly importError: string | null;
}

export function TerrainEditorPage({
  controlPoints,
  onControlPointsChange,
  result,
  exportedJson,
  onExport,
  importText,
  onImportTextChange,
  onImport,
  importError,
}: TerrainEditorPageProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const trajectory = result.trajectory;
  const trajectoryXs = Array.from(trajectory.channels[0] ?? []);
  const trajectoryYs = Array.from(trajectory.channels[1] ?? []);
  const domain = computeViewDomain(
    controlPoints,
    [...trajectoryXs, result.impactX],
    [...trajectoryYs, result.impactY],
  );
  const profile = sampleTerrainProfile(controlPoints, domain, PROFILE_SAMPLE_COUNT);
  const trajectoryProfile = trajectoryXs.map((x, i) => ({ x, y: trajectoryYs[i]! }));

  function replacePoint(index: number, next: TerrainControlPoint): void {
    onControlPointsChange(controlPoints.map((p, i) => (i === index ? next : p)));
  }

  function clientToData(clientX: number, clientY: number): TerrainControlPoint | undefined {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const screenX = ((clientX - rect.left) / rect.width) * VIEWPORT_WIDTH;
    const screenY = ((clientY - rect.top) / rect.height) * VIEWPORT_HEIGHT;
    return {
      x: screenXToDataX(domain, VIEWPORT_WIDTH, screenX),
      y: screenYToDataY(domain, VIEWPORT_HEIGHT, screenY),
    };
  }

  function handleSvgPointerMove(event: JSX.TargetedPointerEvent<SVGSVGElement>): void {
    if (draggingIndex === null) return;
    const data = clientToData(event.clientX, event.clientY);
    if (!data) return;
    replacePoint(draggingIndex, data);
  }

  function stopDragging(): void {
    setDraggingIndex(null);
  }

  function handleAddPoint(): void {
    const last = controlPoints[controlPoints.length - 1]!;
    onControlPointsChange([...controlPoints, { x: last.x + NEW_POINT_X_OFFSET, y: last.y }]);
  }

  function handleRemovePoint(index: number): void {
    onControlPointsChange(controlPoints.filter((_, i) => i !== index));
  }

  return (
    <div class="terrain-editor-page" data-testid="terrain-editor-page">
      <h1>Terrain Editor</h1>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
        width="100%"
        height={VIEWPORT_HEIGHT}
        class="terrain-editor-page-svg"
        data-testid="terrain-editor-svg"
        onPointerMove={handleSvgPointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
      >
        <polyline
          points={profileToSvgPolylinePoints(profile, domain, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)}
          class="terrain-editor-page-ground"
          fill="none"
          data-testid="terrain-editor-ground-line"
        />
        {trajectoryProfile.length > 0 && (
          <polyline
            points={profileToSvgPolylinePoints(
              trajectoryProfile,
              domain,
              VIEWPORT_WIDTH,
              VIEWPORT_HEIGHT,
            )}
            class="terrain-editor-page-trajectory"
            fill="none"
            data-testid="terrain-editor-trajectory-line"
          />
        )}
        {result.landed && (
          <circle
            cx={dataXToScreenX(domain, VIEWPORT_WIDTH, result.impactX)}
            cy={dataYToScreenY(domain, VIEWPORT_HEIGHT, result.impactY)}
            r={5}
            class="terrain-editor-page-impact-marker"
            data-testid="terrain-editor-impact-marker"
          />
        )}
        {controlPoints.map((p, i) => (
          <circle
            key={i}
            cx={dataXToScreenX(domain, VIEWPORT_WIDTH, p.x)}
            cy={dataYToScreenY(domain, VIEWPORT_HEIGHT, p.y)}
            r={CONTROL_POINT_RADIUS}
            class="terrain-editor-page-control-point"
            data-testid={`terrain-editor-control-point-${i}`}
            onPointerDown={() => setDraggingIndex(i)}
          />
        ))}
      </svg>

      <p data-testid="terrain-editor-impact-readout">
        {result.landed
          ? `Impact at x=${formatMeters(result.impactX)}, y=${formatMeters(result.impactY)}`
          : "No impact within the solve window."}
      </p>

      <table class="terrain-editor-page-points" data-testid="terrain-editor-points">
        <thead>
          <tr>
            <th>#</th>
            <th>x (m)</th>
            <th>y (m)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {controlPoints.map((p, i) => (
            <tr key={i} data-testid={`terrain-editor-point-${i}`}>
              <td>{i + 1}</td>
              <td>
                <input
                  type="number"
                  step={0.5}
                  value={p.x}
                  aria-label={`Point ${i + 1} x`}
                  data-testid={`terrain-editor-point-${i}-x`}
                  onInput={(event) =>
                    replacePoint(i, { x: Number(event.currentTarget.value), y: p.y })
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  step={0.5}
                  value={p.y}
                  aria-label={`Point ${i + 1} y`}
                  data-testid={`terrain-editor-point-${i}-y`}
                  onInput={(event) =>
                    replacePoint(i, { x: p.x, y: Number(event.currentTarget.value) })
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  disabled={controlPoints.length <= 2}
                  data-testid={`terrain-editor-point-${i}-remove`}
                  onClick={() => handleRemovePoint(i)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" data-testid="terrain-editor-add-point" onClick={handleAddPoint}>
        Add point
      </button>

      <div class="terrain-editor-page-io">
        <button type="button" data-testid="terrain-editor-export-button" onClick={onExport}>
          Export JSON
        </button>
        {exportedJson !== null && (
          <textarea
            readOnly
            value={exportedJson}
            aria-label="Exported terrain JSON"
            data-testid="terrain-editor-export-output"
          />
        )}

        <label>
          Import JSON
          <textarea
            value={importText}
            aria-label="Import terrain JSON"
            data-testid="terrain-editor-import-input"
            onInput={(event) => onImportTextChange(event.currentTarget.value)}
          />
        </label>
        <button type="button" data-testid="terrain-editor-import-button" onClick={onImport}>
          Import
        </button>
        {importError !== null && (
          <span class="terrain-editor-page-import-error" data-testid="terrain-editor-import-error">
            {importError}
          </span>
        )}
      </div>
    </div>
  );
}
