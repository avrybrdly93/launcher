/**
 * Force glyphs at the projectile marker (§6.2: "live arrows for F_g, F_d,
 * F_M and resultant ... log-scaled with legend. This single feature does
 * more for physical intuition than any panel of numbers." P3.14).
 *
 * `Model` never exposes the individual `ForceModel`s closed over its `rhs`
 * (P1.17's registry is private to `createPlanarProjectileModel`) -- so
 * per-force vectors are computed here directly from the *same* live force
 * instances a caller already has (`ResolvedModel.forces`, `@ballista/runtime`),
 * not re-derived or re-implemented: {@link computeForceGlyphs} calls
 * `model.rhs` once (to refresh `ctx` exactly as a real solve step would --
 * environment sample, `vRel`, `re`, `mach` -- and to obtain the resultant
 * acceleration for the "verified against rhs" cross-check below), then
 * calls each `ForceModel.accumulate` against that same freshened `ctx` to
 * recover its individual contribution. The resultant is read directly from
 * `ctx.forceAccum` (the exact sum `rhs` itself just divided by mass to
 * produce `out[VX]`/`out[VY]`) rather than re-summed from the per-force
 * loop, so there is exactly one source of truth for "what force actually
 * drove this step" between the glyphs and the physics.
 *
 * Log scaling (arrow *length*, never direction) is necessary because force
 * magnitudes span huge, scenario-dependent ranges -- gravity is ~constant
 * while quadratic drag scales with |v|^2, and buoyancy is typically ~1% of
 * weight (P1.16) -- a linear scale would make the smaller ones invisible.
 */

import type { EvalContext, ForceModel, Model, MutVec2 } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { worldToScreen } from "./camera2d.js";
import { nearestRowIndex } from "./hud-readout.js";

/** One force's glyph data at a sampled state: its exact (fx, fy) and derived magnitude. */
export interface ForceGlyph {
  readonly id: string;
  readonly fx: number;
  readonly fy: number;
  readonly magnitude: number;
}

/** Every wired force's glyph plus the resultant, at one (t, y) sample. */
export interface ForceGlyphSet {
  readonly forces: readonly ForceGlyph[];
  readonly resultant: ForceGlyph;
}

/** Preallocated scratch {@link computeForceGlyphs} needs -- reused across frames so it never allocates (§6.5, mirrors `ProjectileSampleScratch`). */
export interface ForceGlyphScratch {
  readonly rhsOut: Float64Array;
  /** `ForceModel.accumulate`'s output param is a plain `MutVec2` tuple, not a `Float64Array` (see `forces.ts`). */
  readonly perForce: MutVec2;
  /** State-vector scratch {@link forceGlyphsAtPlayhead} fills from a `Trajectory`'s recorded channels before delegating to {@link computeForceGlyphs}. */
  readonly y: Float64Array;
}

/** Allocates a {@link ForceGlyphScratch} sized for a model of the given dimension; call once (e.g. alongside the layer's other per-mount state). */
export function createForceGlyphScratch(dim: number): ForceGlyphScratch {
  return { rhsOut: new Float64Array(dim), perForce: [0, 0], y: new Float64Array(dim) };
}

function magnitudeOf(fx: number, fy: number): number {
  return Math.sqrt(fx * fx + fy * fy);
}

/**
 * Computes every wired force's exact vector at `(t, y)`, plus the resultant,
 * writing nothing into `scratch` that survives the call (the returned
 * `ForceGlyph`s hold plain numbers, not views into `scratch`). `forces` is
 * the live instance list a `ResolvedModel` (`@ballista/runtime`) carries
 * alongside `model` -- the same instances `model.rhs` itself composes, so
 * their vectors are guaranteed physically consistent with it, never a
 * parallel reimplementation.
 */
export function computeForceGlyphs(
  model: Model,
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  scratch: ForceGlyphScratch,
): ForceGlyphSet {
  // Refreshes ctx.env/vRel/speedRel/re/mach exactly as a real solve step
  // would, and leaves ctx.forceAccum holding the exact resultant this state
  // actually experiences (out.VX/VY = forceAccum / mass) -- the "verified
  // against rhs" half of this task's validation criterion holds by
  // construction, not by re-deriving the resultant a second way.
  model.rhs(t, y, scratch.rhsOut, ctx);
  const resultantFx = ctx.forceAccum[0]!;
  const resultantFy = ctx.forceAccum[1]!;

  const glyphs: ForceGlyph[] = forces.map((force) => {
    scratch.perForce[0] = 0;
    scratch.perForce[1] = 0;
    force.accumulate(t, y, ctx, scratch.perForce);
    const fx = scratch.perForce[0]!;
    const fy = scratch.perForce[1]!;
    return { id: force.id, fx, fy, magnitude: magnitudeOf(fx, fy) };
  });

  return {
    forces: glyphs,
    resultant: {
      id: "resultant",
      fx: resultantFx,
      fy: resultantFy,
      magnitude: magnitudeOf(resultantFx, resultantFy),
    },
  };
}

/**
 * The {@link ForceGlyphSet} at `playbackTime`, read directly from the
 * nearest recorded row of `trajectory` (mirrors `hud-readout.ts`'s
 * `hudReadoutAtPlayhead`: no interpolation, since there's no recorded
 * derivative to interpolate a force *from* -- a force depends on velocity,
 * which the state channels give exactly at each recorded row, but nothing
 * in between). This is the Forces panel's (P3.22) "badge equals |F| channel
 * at playhead" validation criterion: the badge is whatever this function
 * returns for the row nearest the scrub position, not a separately
 * re-derived number.
 */
export function forceGlyphsAtPlayhead(
  model: Model,
  forces: readonly ForceModel[],
  trajectory: Trajectory,
  playbackTime: number,
  ctx: EvalContext,
  scratch: ForceGlyphScratch,
): ForceGlyphSet {
  const index = nearestRowIndex(trajectory.t, playbackTime);
  const t = trajectory.t[index]!;
  const { channels } = trajectory;

  for (let c = 0; c < channels.length; c++) {
    scratch.y[c] = channels[c]![index]!;
  }

  return computeForceGlyphs(model, forces, t, scratch.y, ctx, scratch);
}

/** Log-scale configuration for {@link logScaleGlyphLength}/{@link forceGlyphLegendTicks}. */
export interface ForceGlyphScaleConfig {
  /** Magnitudes at or below this map to `minLengthPx` (§6.2: "small, always-legible") -- keeps a near-zero force from vanishing entirely. */
  readonly minMagnitude: number;
  /** Magnitudes at or above this map to `maxLengthPx`. */
  readonly maxMagnitude: number;
  readonly minLengthPx: number;
  readonly maxLengthPx: number;
}

export const DEFAULT_FORCE_GLYPH_SCALE: ForceGlyphScaleConfig = Object.freeze({
  minMagnitude: 1e-3,
  maxMagnitude: 1e4,
  minLengthPx: 6,
  maxLengthPx: 48,
});

/**
 * Maps a force magnitude (newtons, >= 0) to an on-screen arrow length,
 * log-scaled between `config.minMagnitude`/`config.maxMagnitude` and clamped
 * to `[minLengthPx, maxLengthPx]` (§6.2 "log-scaled ... small, always
 * legible"). Exactly `0` (a force genuinely absent at this state, e.g. no
 * spin so no Magnus contribution) maps to `0` -- nothing to draw -- rather
 * than the floor length, which is reserved for a *nonzero* but tiny force.
 */
export function logScaleGlyphLength(
  magnitude: number,
  config: ForceGlyphScaleConfig = DEFAULT_FORCE_GLYPH_SCALE,
): number {
  if (!(magnitude > 0)) return 0;

  const { minMagnitude, maxMagnitude, minLengthPx, maxLengthPx } = config;
  const logMin = Math.log10(minMagnitude);
  const logMax = Math.log10(maxMagnitude);
  const logMag = Math.log10(magnitude);

  const fraction = (logMag - logMin) / (logMax - logMin);
  const clampedFraction = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return minLengthPx + clampedFraction * (maxLengthPx - minLengthPx);
}

/** One legend entry: a representative force magnitude and the arrow length it maps to. */
export interface ForceGlyphLegendTick {
  readonly magnitude: number;
  readonly lengthPx: number;
}

/**
 * A handful of reference magnitudes spanning `config`'s decades (one per
 * decade, endpoints included), with their mapped lengths -- what a legend
 * renders so a viewer can read an arrow's length back into newtons.
 */
export function forceGlyphLegendTicks(
  config: ForceGlyphScaleConfig = DEFAULT_FORCE_GLYPH_SCALE,
): readonly ForceGlyphLegendTick[] {
  const logMin = Math.log10(config.minMagnitude);
  const logMax = Math.log10(config.maxMagnitude);
  const decades = Math.max(1, Math.round(logMax - logMin));

  const ticks: ForceGlyphLegendTick[] = [];
  for (let i = 0; i <= decades; i++) {
    const magnitude = Math.pow(10, logMin + (i / decades) * (logMax - logMin));
    ticks.push({ magnitude, lengthPx: logScaleGlyphLength(magnitude, config) });
  }
  return ticks;
}

/** A world-space direction (not a point) as its on-screen unit vector: x is unscaled, y flips sign (§6.1 "y-flip lives" in world<->screen). Zero-magnitude input maps to `(0, 0)` -- nothing to draw. */
export function worldForceDirectionToScreen(fx: number, fy: number): { dx: number; dy: number } {
  const magnitude = Math.hypot(fx, fy);
  if (magnitude === 0) return { dx: 0, dy: 0 };
  return { dx: fx / magnitude, dy: -fy / magnitude };
}

/** The subset of `CanvasRenderingContext2D` `drawForceGlyphLayer` needs. */
export interface ForceGlyphCanvas {
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/** Per-force-id stroke color; `"resultant"` keys the resultant arrow's color. */
export type ForceGlyphColors = Readonly<Record<string, string>>;

export const DEFAULT_FORCE_GLYPH_COLORS: ForceGlyphColors = Object.freeze({
  gravity: "#4c6ef5",
  "drag-linear": "#f08c00",
  "drag-quadratic": "#f08c00",
  magnus: "#12b886",
  buoyancy: "#ae3ec9",
  resultant: "#212529",
});

const ARROWHEAD_LENGTH_PX = 6;
const ARROWHEAD_ANGLE_RAD = Math.PI / 7;

/** Draws one arrow (shaft + head) from `(x0, y0)` by screen-space offset `(dx, dy)`. Shared with `field-layer.ts` (P3.27) -- the same arrowhead geometry, just fed a linearly- rather than log-scaled length. */
export function drawArrow(
  canvas: ForceGlyphCanvas,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
): void {
  const x1 = x0 + dx;
  const y1 = y0 + dy;

  canvas.beginPath();
  canvas.moveTo(x0, y0);
  canvas.lineTo(x1, y1);
  canvas.stroke();

  const angle = Math.atan2(dy, dx);
  canvas.beginPath();
  canvas.moveTo(x1, y1);
  canvas.lineTo(
    x1 - ARROWHEAD_LENGTH_PX * Math.cos(angle - ARROWHEAD_ANGLE_RAD),
    y1 - ARROWHEAD_LENGTH_PX * Math.sin(angle - ARROWHEAD_ANGLE_RAD),
  );
  canvas.moveTo(x1, y1);
  canvas.lineTo(
    x1 - ARROWHEAD_LENGTH_PX * Math.cos(angle + ARROWHEAD_ANGLE_RAD),
    y1 - ARROWHEAD_LENGTH_PX * Math.sin(angle + ARROWHEAD_ANGLE_RAD),
  );
  canvas.stroke();
}

/**
 * Draws one log-scaled arrow per wired force plus the resultant, rooted at
 * the projectile marker's screen position (§6.2, §6.1 ProjectileLayer
 * "velocity/force glyphs"). A force whose magnitude is exactly `0` at this
 * state (e.g. Magnus with no spin) draws nothing -- `logScaleGlyphLength`
 * maps `0` to `0`. `worldOut` is the marker's already-sampled world position
 * (`sampleProjectilePosition`, P3.12); this function does not itself
 * re-sample it.
 */
export function drawForceGlyphLayer(
  canvas: ForceGlyphCanvas,
  camera: Camera2DState,
  viewport: Viewport,
  glyphSet: ForceGlyphSet,
  worldOut: Float64Array,
  scaleConfig: ForceGlyphScaleConfig = DEFAULT_FORCE_GLYPH_SCALE,
  colors: ForceGlyphColors = DEFAULT_FORCE_GLYPH_COLORS,
): void {
  const origin = worldToScreen(camera, viewport, { x: worldOut[0]!, y: worldOut[1]! });

  for (const glyph of [...glyphSet.forces, glyphSet.resultant]) {
    const lengthPx = logScaleGlyphLength(glyph.magnitude, scaleConfig);
    if (lengthPx <= 0) continue;

    const { dx, dy } = worldForceDirectionToScreen(glyph.fx, glyph.fy);
    canvas.strokeStyle = colors[glyph.id] ?? DEFAULT_FORCE_GLYPH_COLORS.resultant!;
    canvas.lineWidth = glyph.id === "resultant" ? 2 : 1;
    drawArrow(canvas, origin.x, origin.y, dx * lengthPx, dy * lengthPx);
  }
}
