/**
 * `ReadoutLayer`'s live scalar HUD values (§6.1 HudLayer; P3.15): t, |v|, E,
 * Re, S, Π at the current playhead.
 *
 * Mirrors `force-glyphs.ts`'s pattern: {@link computeHudReadout} calls
 * `model.rhs` once to refresh `ctx` exactly as a real solve step would
 * (environment sample, `vRel`, `re`, `mach`), then derives every readout
 * from that same freshened `ctx` plus the state `y` itself -- one source of
 * truth for "what this state's numbers are", not a parallel
 * reimplementation of the physics.
 *
 * {@link hudReadoutAtPlayhead} is the Trajectory-facing entry point: unlike
 * `ProjectileLayer`'s marker (P3.12), which Hermite-interpolates position
 * from the recorded `vx`/`vy` derivatives, the readouts here have no
 * recorded derivative to interpolate velocity *from* (acceleration isn't a
 * recorded channel) -- so it snaps to the nearest recorded row instead of
 * interpolating, which is also exactly what this task's validation
 * criterion asks for: "values equal recorder channels at playhead".
 */

import {
  dimensionlessPi,
  mechanicalEnergy,
  spinParameter,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import { bracketStepIndex } from "./projectile-layer.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** The live HUD scalar values at one sampled state (§6.1 ReadoutLayer). */
export interface HudReadout {
  readonly t: number;
  /** |v|, true (ground-frame) speed -- the same velocity `mechanicalEnergy` uses. */
  readonly speed: number;
  /** Mechanical energy E = (1/2)m|v|^2 + mgy (§3.8). */
  readonly energy: number;
  /** Reynolds number at this state, refreshed by the `model.rhs` call this function makes internally. */
  readonly reynolds: number;
  /** Magnus spin ratio S = |omega|*R/|v_rel| (eq. 3.16); 0 when no spin is wired. */
  readonly spinRatio: number;
  /** Dimensionless drag-to-gravity group Π (§3.6), evaluated at this state's relative speed. */
  readonly pi: number;
}

/** Preallocated scratch {@link computeHudReadout} needs -- reused across frames so it never allocates (§6.5, mirrors `ForceGlyphScratch`). */
export interface HudReadoutScratch {
  readonly rhsOut: Float64Array;
  readonly y: Float64Array;
}

/** Allocates a {@link HudReadoutScratch} sized for a model of the given dimension; call once (e.g. alongside the layer's other per-mount state). */
export function createHudReadoutScratch(dim: number): HudReadoutScratch {
  return { rhsOut: new Float64Array(dim), y: new Float64Array(dim) };
}

/**
 * Computes every HUD readout at `(t, y)`: refreshes `ctx` via `model.rhs`
 * (so `ctx.re`/`ctx.speedRel`/`ctx.env` reflect this exact state), then
 * derives `speed`/`energy`/`reynolds`/`spinRatio`/`pi` from that freshened
 * `ctx`. Allocates nothing beyond `scratch` (owned by the caller).
 */
export function computeHudReadout(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  scratch: HudReadoutScratch,
): HudReadout {
  model.rhs(t, y, scratch.rhsOut, ctx);

  const vx = y[VX]!;
  const vy = y[VY]!;

  return {
    t,
    speed: Math.hypot(vx, vy),
    energy: mechanicalEnergy(y, ctx),
    reynolds: ctx.re,
    spinRatio: spinParameter(ctx.params.spin, ctx.params.radius, ctx.speedRel),
    pi: dimensionlessPi(ctx.params, ctx.env, ctx.speedRel),
  };
}

/**
 * Index of the recorded row whose `t` is closest to `playbackTime` --
 * `bracketStepIndex`'s bracketing interval, resolved to whichever endpoint
 * is nearer (ties favor the earlier row). Reuses `bracketStepIndex`'s own
 * out-of-span clamping, so a `playbackTime` before/after the recorded span
 * lands on the first/last row rather than throwing.
 */
export function nearestRowIndex(t: ArrayLike<number>, playbackTime: number): number {
  const lo = bracketStepIndex(t, playbackTime);
  const hi = Math.min(lo + 1, t.length - 1);
  return Math.abs(t[hi]! - playbackTime) < Math.abs(t[lo]! - playbackTime) ? hi : lo;
}

/**
 * The HUD readout at `playbackTime`, read directly from the nearest
 * recorded row of `trajectory` (its exact `t`/`x`/`y`/`vx`/`vy` channel
 * values -- no interpolation, see module docs) and run through {@link
 * computeHudReadout}. Assumes `trajectory`'s channels are the planar
 * projectile model's `[x, y, vx, vy]` convention (shared with
 * `projectile-layer.ts`/`trajectory-layer.ts`).
 */
export function hudReadoutAtPlayhead(
  model: Model,
  trajectory: Trajectory,
  playbackTime: number,
  ctx: EvalContext,
  scratch: HudReadoutScratch,
): HudReadout {
  const index = nearestRowIndex(trajectory.t, playbackTime);
  const t = trajectory.t[index]!;
  const { channels } = trajectory;

  scratch.y[X] = channels[X]![index]!;
  scratch.y[Y] = channels[Y]![index]!;
  scratch.y[VX] = channels[VX]![index]!;
  scratch.y[VY] = channels[VY]![index]!;

  return computeHudReadout(model, t, scratch.y, ctx, scratch);
}
