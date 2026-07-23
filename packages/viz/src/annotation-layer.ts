/**
 * `AnnotationLayer` (§6.1 WorldLayer: "apex, impact, range markers, target";
 * P3.16). Derives world-space markers directly from a solve's own results
 * -- the recorded `Trajectory` and its localized non-terminal `EventRoot`s
 * (`EventCollector`, P3.13) -- rather than recomputing physics: apex comes
 * from the `"apex"` event's own root-localized state (already precise to
 * Brent's convergence tolerance, §4.9), and impact/range come from the
 * trajectory's final recorded row, which is exactly the root-localized
 * ground-impact state whenever the model's terminal ground-impact event is
 * what ended the solve (P2.34 "terminal-event step truncation + exact
 * event-state recording") -- not an approximate last-accepted-step
 * overshoot. This is what lets the range marker hit the drag-free analytic
 * formula to 1e-9 (this task's validation criterion): both endpoints it's
 * built from are already exact to that precision, by construction.
 *
 * Mirrors `trajectory-layer.ts`/`axes-layer.ts`'s pure-computation +
 * minimal-canvas-interface split: {@link computeAnnotations} is pure and
 * unit-testable without a DOM, {@link drawAnnotationLayer} is the thin
 * rendering pass over it.
 */

import type { EventRoot, Trajectory } from "@ballista/solverkit";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { worldToScreen } from "./camera2d.js";

/** Column indices shared with `projectile-layer.ts`/`trajectory-layer.ts`'s `[x, y, vx, vy]` convention. */
const X_CHANNEL = 0;
const Y_CHANNEL = 1;

/** One world-space annotation marker: a labeled point. */
export interface AnnotationMarker {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

/** Every marker {@link computeAnnotations} can derive from one solve's trajectory/events. */
export interface AnnotationSet {
  /** The first `"apex"` event's position, or `null` if the trajectory declares no apex crossing (e.g. it never climbs). */
  readonly apex: AnnotationMarker | null;
  /** The trajectory's final recorded position, or `null` for an empty trajectory. */
  readonly impact: AnnotationMarker | null;
  /** Horizontal displacement from launch to `impact`, or `null` alongside a `null` `impact`. */
  readonly range: number | null;
}

/**
 * Derives apex/impact/range from `trajectory` and its solve's collected
 * `events` (`EventCollector.events`, P3.13). `events` need not be sorted or
 * apex-only -- the first entry named `"apex"` wins, matching the planar
 * projectile model's single-apex flights (§3.9); a stunt trajectory with
 * multiple apex crossings only ever gets the first annotated here, which is
 * the same scope this task's validation criterion exercises.
 */
export function computeAnnotations(
  trajectory: Trajectory,
  events: readonly EventRoot[],
): AnnotationSet {
  const apexEvent = events.find((root) => root.event.name === "apex");
  const apex = apexEvent
    ? { label: "apex", x: apexEvent.y[X_CHANNEL]!, y: apexEvent.y[Y_CHANNEL]! }
    : null;

  if (trajectory.nSteps === 0) {
    return { apex, impact: null, range: null };
  }

  const lastRow = trajectory.nSteps - 1;
  const launchX = trajectory.channels[X_CHANNEL]![0]!;
  const impactX = trajectory.channels[X_CHANNEL]![lastRow]!;
  const impactY = trajectory.channels[Y_CHANNEL]![lastRow]!;
  const impact = { label: "impact", x: impactX, y: impactY };

  return { apex, impact, range: impactX - launchX };
}

/** The subset of `CanvasRenderingContext2D` `drawAnnotationLayer` needs. */
export interface AnnotationLayerCanvas {
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: readonly number[]): void;
}

/** Options for {@link drawAnnotationLayer}. */
export interface AnnotationLayerOptions {
  readonly markerColor?: string;
  readonly markerRadiusPx?: number;
  readonly rangeLineColor?: string;
  readonly font?: string;
}

const DEFAULT_OPTIONS: Required<AnnotationLayerOptions> = {
  markerColor: "#e8590c",
  markerRadiusPx: 4,
  rangeLineColor: "#868e96",
  font: "12px sans-serif",
};

function drawMarker(
  canvas: AnnotationLayerCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  marker: AnnotationMarker,
  options: Required<AnnotationLayerOptions>,
): void {
  const screen = worldToScreen(camera, viewport, { x: marker.x, y: marker.y });

  canvas.fillStyle = options.markerColor;
  canvas.beginPath();
  canvas.arc(screen.x, screen.y, options.markerRadiusPx, 0, 2 * Math.PI);
  canvas.fill();

  canvas.font = options.font;
  canvas.textAlign = "center";
  canvas.textBaseline = "bottom";
  canvas.fillText(marker.label, screen.x, screen.y - options.markerRadiusPx - 2);
}

/**
 * Draws every marker in `annotations`: apex/impact as small filled dots
 * with a label, plus (when both `impact` and `range` are present) a dashed
 * horizontal line from launch to impact labeled with the range's numeric
 * value, at the impact point's screen height. Draws nothing for a `null`
 * field -- e.g. a trajectory with no apex event still draws impact/range.
 */
export function drawAnnotationLayer(
  canvas: AnnotationLayerCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  annotations: AnnotationSet,
  options: AnnotationLayerOptions = {},
): void {
  const resolved = { ...DEFAULT_OPTIONS, ...options };

  if (annotations.apex) {
    drawMarker(canvas, camera, viewport, annotations.apex, resolved);
  }
  if (annotations.impact) {
    drawMarker(canvas, camera, viewport, annotations.impact, resolved);

    if (annotations.range !== null) {
      const launch = worldToScreen(camera, viewport, {
        x: annotations.impact.x - annotations.range,
        y: annotations.impact.y,
      });
      const impact = worldToScreen(camera, viewport, {
        x: annotations.impact.x,
        y: annotations.impact.y,
      });

      canvas.strokeStyle = resolved.rangeLineColor;
      canvas.lineWidth = 1;
      canvas.setLineDash([4, 4]);
      canvas.beginPath();
      canvas.moveTo(launch.x, launch.y);
      canvas.lineTo(impact.x, impact.y);
      canvas.stroke();
      canvas.setLineDash([]);

      canvas.fillStyle = resolved.rangeLineColor;
      canvas.font = resolved.font;
      canvas.textAlign = "center";
      canvas.textBaseline = "top";
      const midX = (launch.x + impact.x) / 2;
      canvas.fillText(`R = ${annotations.range.toFixed(2)} m`, midX, impact.y + 4);
    }
  }
}
