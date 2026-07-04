/** Maps spin ratio S = omega*R/|v_rel| to a lift coefficient for the Magnus force (§3.6). */
export interface LiftCoefficientModel {
  cl(spinRatio: number): number;
}

/** Smooth-saturating fit CL(S) = min(0.6, 1.6*S) from eq. (3.16). */
export class SaturatingLiftCoefficient implements LiftCoefficientModel {
  constructor(
    private readonly maxCl = 0.6,
    private readonly slope = 1.6,
  ) {}

  cl(spinRatio: number): number {
    return Math.min(this.maxCl, this.slope * Math.abs(spinRatio));
  }
}
