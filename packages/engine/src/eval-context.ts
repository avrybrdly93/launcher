import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import { norm, type MutVec2 } from "./vec2.js";
import type { ProjectileParams } from "./projectile-params.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * Per-model scratch context passed into `Model.rhs` on every call (§3.7).
 * Every field except `environment` and `params` is a reused buffer that gets
 * overwritten in place once per rhs evaluation — nothing here is
 * reallocated, which is what keeps the hot path allocation-free (ADR-004).
 */
export interface EvalContext {
  readonly environment: Environment;
  readonly params: ProjectileParams;
  /** Environment sample at the current (t, r), refreshed once per rhs call. */
  readonly env: EnvSample;
  /** v - w, refreshed once per rhs call. */
  readonly vRel: MutVec2;
  /** |vRel|, refreshed once per rhs call. */
  speedRel: number;
  /** Reynolds number at the current state, refreshed once per rhs call. */
  re: number;
  /** Mach number at the current state, refreshed once per rhs call. */
  mach: number;
  /** Scratch accumulator for composeForces' output, refreshed once per rhs call. */
  readonly forceAccum: MutVec2;
}

export function createEvalContext(environment: Environment, params: ProjectileParams): EvalContext {
  return {
    environment,
    params,
    env: new EnvSample(),
    vRel: [0, 0],
    speedRel: 0,
    re: 0,
    mach: 0,
    forceAccum: [0, 0],
  };
}

/**
 * Refreshes every scratch field of `ctx` (env sample, v_rel, speedRel, re,
 * mach) for state `y` at time `t` — the same per-evaluation setup `rhs` does
 * before composing forces. Anything that reads `ctx.env`/`vRel`/`speedRel`
 * outside of a `Model.rhs` call (e.g. `energy.ts`'s power aggregation) must
 * call this first; those scratch fields are otherwise whatever the last
 * `rhs` call left them as, not derived from the `y` just passed in.
 */
export function refreshEvalContext(t: number, y: Float64Array, ctx: EvalContext): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);

  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}
