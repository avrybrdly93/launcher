import type { EventActionOutcome } from "./model.js";

/**
 * Restitution bounce parameters (§4.9, §7 P4.11, ADR-021): `e` is the normal
 * coefficient of restitution (1 = perfectly elastic, 0 = fully inelastic),
 * `muF` is the tangential friction retention factor (1 = no friction, 0 =
 * tangential velocity fully arrested). Both are dimensionless ratios applied
 * directly to the pre-impact velocity components, not physical friction
 * coefficients integrated over the contact duration -- the instantaneous
 * impulse model the blueprint's task table specifies.
 *
 * `vRest` is the third of the three and the reason ADR-021 exists: the normal
 * **rebound** speed, in m/s, at or below which an impact is a resting contact
 * rather than a bounce. It has no default on purpose. For `e < 1` the impact
 * sequence is Zeno -- infinitely many impacts accumulating at a finite
 * `t_inf` -- so *something* has to say when the bouncing stops, and a default
 * would be exactly the ad-hoc epsilon P0.103 was filed to avoid, buried one
 * layer below the person who knows the ball and the surface.
 */
export interface RestitutionParams {
  readonly e: number;
  readonly muF: number;
  /**
   * Normal rebound speed (m/s) at or below which the impact is a resting
   * contact: `v_y` is zeroed, `muF` is still applied to `v_x`, and the solve
   * ends at the ground with `status: "ok"`.
   *
   * Must be finite and non-negative. **Zero is legal**, and is how a caller
   * asks for no threshold of their own — a legitimate thing to want from a
   * teaching platform and an illegitimate thing to get by accident, which is
   * the whole reason this field is required rather than defaulted.
   *
   * **`0` is not, however, the absence of a rest condition** (P0.101, and a
   * correction to ADR-021's original wording). The rebound speed decays
   * geometrically, so `v_y` eventually underflows to exactly `0` and
   * `e*|v_y| <= 0` is then true: the rest condition fires at the underflow
   * floor and the sequence is finite there. Measured for a drag-free ball
   * from `h0 = 5` at `e = 0.2`: 465 impacts, then rest on the ground with
   * `status: "ok"` at `t = 1.5147085` against `t_inf = 1.5147150`. Only 8 of
   * those advance time; the tail is P0.144.
   */
  readonly vRest: number;
}

/**
 * Builds a terminal-event `action` (P4.11, ADR-021) implementing an
 * instantaneous restitution bounce: v_y ← −e·v_y, v_x ← μ_f·v_x, every other
 * channel (position, and any extra scalar state such as spin) passed through
 * unchanged. `vxIndex`/`vyIndex` are the model's own velocity-channel
 * indices, so this is reusable across any planar model whose event fires on
 * ground contact. With `e=1, muF=1` the transform is exact (a sign flip and
 * a multiply-by-one), so mechanical energy is conserved across the bounce to
 * full floating-point precision -- P4.11's own validation criterion.
 *
 * **The rebound speed decides whether this impact is a bounce at all.** When
 * `e·|v_y|` -- the speed the projectile would leave with -- is at or below
 * `vRest`, the impact is a resting contact instead: the normal impulse is
 * fully inelastic (`v_y ← 0`), the tangential impulse still applies, and the
 * action returns `"stop"` so the solve ends at the ground rather than
 * launching a flight too short to be resolved. ADR-021 has the argument;
 * the short version is that without it the sequence is Zeno and the last
 * unresolvable bounce drops the projectile through the terrain with
 * `status: "ok"`.
 *
 * The test is on the *rebound* speed rather than the approach speed because
 * the rebound speed is what determines the discarded tail: stopping at `v+`
 * gives up a flight of duration `2·v+/(g·(1−e))` and height `v+²/(2g)`, both
 * monotone in `v+` and therefore bounded by their values at `vRest`.
 *
 * Throws `RangeError` on a `vRest` that is negative or not finite -- a
 * negative threshold can never fire and a `NaN` one never compares true, so
 * both are silently "no rest condition" and neither is distinguishable from
 * the deliberate `vRest: 0`.
 */
export function restitutionBounceAction(
  vxIndex: number,
  vyIndex: number,
  { e, muF, vRest }: RestitutionParams,
): (t: number, y: Float64Array, out: Float64Array) => EventActionOutcome {
  if (!Number.isFinite(vRest) || vRest < 0) {
    throw new RangeError(
      `restitutionBounceAction: vRest must be finite and >= 0, got ${vRest}. ` +
        `Pass 0 to opt out of the rest condition and keep the Zeno bounce sequence (ADR-021).`,
    );
  }
  return (_t: number, y: Float64Array, out: Float64Array): EventActionOutcome => {
    const vy = y[vyIndex]!;
    out.set(y);
    out[vxIndex] = muF * y[vxIndex]!;
    if (e * Math.abs(vy) <= vRest) {
      out[vyIndex] = 0;
      return "stop";
    }
    out[vyIndex] = -e * vy;
    return "continue";
  };
}

/**
 * Wraps a bounce `action` so the post-impact position sits exactly on the
 * surface, returning the wrapped action's own outcome unchanged (P0.101).
 *
 * **Why this exists.** `scanStepForEvents` decides an event is active at a
 * step's start with `g0 === 0` exactly, and that test is what arms the
 * `DEPARTURE_THETAS` ladder that brackets a short return flight. But the
 * state a restitution bounce resumes from is Brent's localized root, whose
 * `g_gnd` is zero only to within the root find's own error -- measured at up
 * to ~1e-15 m and of *either sign*. `restitutionBounceAction` passes the
 * position through, so a negative residual makes the next step start
 * nominally below the terrain: the ladder is not armed, the scan falls back
 * to the interior samples alone, and a flight shorter than a quarter step
 * ends before the first of them. No sign change, no impact, and the
 * projectile then free-falls through the ground with `status: "ok"`.
 *
 * **The snap is exact rather than a tolerance**, which is the point. The
 * impact is *on* the surface by the event's own definition `g = y − h(x)`,
 * so writing `h(x)` back removes the root find's error instead of
 * accommodating it, and restores the invariant `event-detection.ts` already
 * assumes. `xIndex` is untouched by the bounce action -- it copies the whole
 * state and overwrites only the two velocity channels -- so `surfaceHeight`
 * is evaluated at the same abscissa the event itself used.
 *
 * This lives in the engine, and takes `surfaceHeight` rather than reaching
 * for it, because `restitutionBounceAction` has only channel indices and no
 * terrain: that is exactly why ADR-021 could not do this in the action. It
 * is a separate exported wrapper rather than an extra parameter so a caller
 * with no terrain is unaffected and so it can be tested on its own.
 *
 * Measured: with the snap in place a drag-free bouncing ball rests at the
 * impact number the *model* predicts -- `ceil(log(vRest/v0)/log(e))` -- for
 * every stepper and step size tried, instead of wherever the detection floor
 * happened to fall. Without it, 22 of 24 swept configurations lost an impact
 * before the rest threshold could fire.
 */
export function withSurfaceSnap(
  action: (t: number, y: Float64Array, out: Float64Array) => EventActionOutcome,
  xIndex: number,
  yIndex: number,
  surfaceHeight: (x: number) => number,
): (t: number, y: Float64Array, out: Float64Array) => EventActionOutcome {
  return (t: number, y: Float64Array, out: Float64Array): EventActionOutcome => {
    const outcome = action(t, y, out);
    out[yIndex] = surfaceHeight(out[xIndex]!);
    return outcome;
  };
}
