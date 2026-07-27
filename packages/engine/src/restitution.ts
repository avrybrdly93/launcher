/**
 * Restitution bounce parameters (§4.9, §7 P4.11): `e` is the normal
 * coefficient of restitution (1 = perfectly elastic, 0 = fully inelastic),
 * `muF` is the tangential friction retention factor (1 = no friction, 0 =
 * tangential velocity fully arrested). Both are dimensionless ratios applied
 * directly to the pre-impact velocity components, not physical friction
 * coefficients integrated over the contact duration -- the instantaneous
 * impulse model the blueprint's task table specifies.
 */
export interface RestitutionParams {
  readonly e: number;
  readonly muF: number;
}

/**
 * Builds a terminal-event `action` (P4.11) implementing an instantaneous
 * restitution bounce: v_y ← −e·v_y, v_x ← μ_f·v_x, every other channel
 * (position, and any extra scalar state such as spin) passed through
 * unchanged. `vxIndex`/`vyIndex` are the model's own velocity-channel
 * indices, so this is reusable across any planar model whose event fires on
 * ground contact. With `e=1, muF=1` the transform is exact (a sign flip and
 * a multiply-by-one), so mechanical energy is conserved across the bounce to
 * full floating-point precision -- P4.11's own validation criterion.
 */
export function restitutionBounceAction(
  vxIndex: number,
  vyIndex: number,
  { e, muF }: RestitutionParams,
): (t: number, y: Float64Array, out: Float64Array) => void {
  return (_t: number, y: Float64Array, out: Float64Array): void => {
    out.set(y);
    out[vxIndex] = muF * y[vxIndex]!;
    out[vyIndex] = -e * y[vyIndex]!;
  };
}
