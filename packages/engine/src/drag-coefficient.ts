import { PchipInterpolator } from "./pchip.js";

/** Maps flow regime (Reynolds, Mach) to a drag coefficient (§3.3). */
export interface DragCoefficientModel {
  cd(re: number, mach: number): number;
  /**
   * ∂Cd/∂Re at (re, mach), for the analytic drag Jacobian (P1.22). Optional —
   * models that omit it are treated as having zero Re-slope, which is exact
   * for ConstantCd and wrong (silently) only for a future Cd(Re) model that
   * doesn't implement this; none currently omits it.
   */
  dcdDRe?(re: number, mach: number): number;
}

/** Smooth sphere, subcritical regime — the platform default (§3.3 option 1). */
export class ConstantCd implements DragCoefficientModel {
  constructor(private readonly value = 0.47) {}

  cd(_re: number, _mach: number): number {
    return this.value;
  }

  dcdDRe(_re: number, _mach: number): number {
    return 0;
  }
}

/**
 * Smooth-sphere Cd(Re) including the drag crisis near Re ~ 3e5, where Cd
 * falls from ~0.47 to ~0.1 as the boundary layer transitions to turbulent
 * (§3.3 option 2). PCHIP guarantees C1 continuity without overshoot, unlike
 * a naive piecewise-linear or unconstrained-spline fit.
 */
export class TabulatedReynoldsCd implements DragCoefficientModel {
  private readonly interpolator: PchipInterpolator;

  constructor(table: { re: readonly number[]; cd: readonly number[] } = SMOOTH_SPHERE_CD_TABLE) {
    this.interpolator = new PchipInterpolator(table.re, table.cd);
  }

  cd(re: number, _mach: number): number {
    return this.interpolator.evaluate(re);
  }

  dcdDRe(re: number, _mach: number): number {
    return this.interpolator.derivative(re);
  }
}

/** Approximate smooth-sphere drag curve, log-spaced in Re, spanning the drag crisis. */
export const SMOOTH_SPHERE_CD_TABLE = {
  re: [1e1, 1e2, 1e3, 1e4, 1e5, 2e5, 3e5, 4e5, 1e6, 1e7],
  cd: [4.1, 1.1, 0.47, 0.5, 0.5, 0.4, 0.1, 0.18, 0.2, 0.2],
} as const;
