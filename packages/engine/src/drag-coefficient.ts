import { PchipInterpolator } from "./pchip.js";

/** Maps flow regime (Reynolds, Mach) to a drag coefficient (§3.3). */
export interface DragCoefficientModel {
  /** Drag coefficient at the given Reynolds and Mach numbers. */
  cd(re: number, mach: number): number;
}

/** Smooth sphere, subcritical regime — the platform default (§3.3 option 1). */
export class ConstantCd implements DragCoefficientModel {
  constructor(private readonly value = 0.47) {}

  /** @inheritDoc */
  cd(_re: number, _mach: number): number {
    return this.value;
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

  /** @inheritDoc */
  cd(re: number, _mach: number): number {
    return this.interpolator.evaluate(re);
  }
}

/** Approximate smooth-sphere drag curve, log-spaced in Re, spanning the drag crisis. */
export const SMOOTH_SPHERE_CD_TABLE = {
  re: [1e1, 1e2, 1e3, 1e4, 1e5, 2e5, 3e5, 4e5, 1e6, 1e7],
  cd: [4.1, 1.1, 0.47, 0.5, 0.5, 0.4, 0.1, 0.18, 0.2, 0.2],
} as const;

/**
 * Mach-dependent Cd(M) with the classic transonic drag rise: a subsonic
 * plateau near the constant-Cd default, a sharp climb through M~0.8-1.2 as
 * shock-induced pressure drag appears, a peak just past Mach 1, and a slow
 * supersonic falloff (§3.3 option 4). Requires the atmosphere to supply a
 * temperature-dependent local speed of sound c(T) for M = |v_rel|/c to be
 * meaningful (P4.01/P4.03). PCHIP again guarantees C1 continuity through the
 * rise, matching TabulatedReynoldsCd's rationale.
 */
export class TabulatedMachCd implements DragCoefficientModel {
  private readonly interpolator: PchipInterpolator;

  constructor(table: { mach: readonly number[]; cd: readonly number[] } = TRANSONIC_MACH_CD_TABLE) {
    this.interpolator = new PchipInterpolator(table.mach, table.cd);
  }

  /** @inheritDoc */
  cd(_re: number, mach: number): number {
    return this.interpolator.evaluate(mach);
  }
}

/** Representative transonic drag-rise curve for a bluff (sphere-like) body, linear in M. */
export const TRANSONIC_MACH_CD_TABLE = {
  mach: [0, 0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0, 3.0],
  cd: [0.47, 0.47, 0.48, 0.5, 0.65, 0.9, 1.05, 1.0, 0.85, 0.7, 0.6],
} as const;
