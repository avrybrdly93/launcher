import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import { norm, type MutVec2 } from "./vec2.js";
import type { ProjectileParams } from "./projectile-params.js";

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
 * Samples the environment at (t, x, y) and refreshes vRel/speedRel/re/mach
 * from (vx, vy) — the shared preamble every rhs-adjacent evaluation (the
 * planar-projectile rhs itself, and anything else that needs a force's
 * `accumulate`/`energyPower` at an arbitrary state, e.g. the energy-invariant
 * "from powers" check of P1.24) needs before touching `ctx`.
 */
export function refreshEvalContext(
  t: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  ctx: EvalContext,
): void {
  ctx.environment.sample(t, x, y, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  ctx.speedRel = norm(ctx.vRel);
  ctx.re = (ctx.env.rho * ctx.speedRel * (2 * ctx.params.radius)) / ctx.env.eta;
  ctx.mach = ctx.env.c > 0 ? ctx.speedRel / ctx.env.c : 0;
}
