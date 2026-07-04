import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { MutVec2 } from "./vec2.js";
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
