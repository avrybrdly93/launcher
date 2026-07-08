import { projectileParamsFromSpec, type ProjectileSpec } from "./projectile-assets.js";

/**
 * Characteristic scales (§3.3, §3.8) used by validation and the UI's
 * "how big are the effects" readout: terminal velocity, the drag
 * relaxation timescale, the dimensionless drag-to-gravity group Pi, and a
 * drag-free estimate of apex height.
 */
export interface CharacteristicScales {
  /** v_T = sqrt(2mg / (rho*Cd*A)) (eq. 3.10). */
  readonly terminalVelocity: number;
  /** tau_drag = v_T/g: the time scale over which quadratic drag matters. */
  readonly dragTimescale: number;
  /** Pi = (v0/v_T)^2 = rho*Cd*A*v0^2 / (2mg): the drag-to-gravity ratio. */
  readonly pi: number;
  /** Drag-free apex height estimate v0^2*sin^2(theta)/(2g); a leading-order reference, not the true apex under drag. */
  readonly apexEstimate: number;
}

export function computeCharacteristicScales(params: {
  readonly mass: number;
  readonly area: number;
  readonly cd: number;
  readonly rho: number;
  readonly g: number;
  readonly v0: number;
  readonly launchAngleRad: number;
}): CharacteristicScales {
  const { mass, area, cd, rho, g, v0, launchAngleRad } = params;
  const terminalVelocity = Math.sqrt((2 * mass * g) / (rho * cd * area));
  const dragTimescale = terminalVelocity / g;
  const pi = (v0 / terminalVelocity) ** 2;
  const sinTheta = Math.sin(launchAngleRad);
  const apexEstimate = (v0 * v0 * sinTheta * sinTheta) / (2 * g);

  return { terminalVelocity, dragTimescale, pi, apexEstimate };
}

/**
 * Characteristic scales for a `ProjectileSpec` asset (§3.9), exposed as
 * scenario metadata (the nondimensional groups the UI/preset library
 * organize by, rather than raw parameters). Cd is evaluated at the given
 * launch speed `v0` (not resolved self-consistently at v_T), a reasonable
 * simplification for a single-number characteristic-scales readout.
 */
export function computeAssetCharacteristicScales(
  spec: ProjectileSpec,
  environment: { readonly rho: number; readonly g: number; readonly eta: number },
  v0: number,
  launchAngleRad = 0,
): CharacteristicScales {
  const params = projectileParamsFromSpec(spec);
  const re = (environment.rho * v0 * (2 * params.radius)) / environment.eta;
  const cd = params.dragCoefficient.cd(re, 0);

  return computeCharacteristicScales({
    mass: params.mass,
    area: params.area,
    cd,
    rho: environment.rho,
    g: environment.g,
    v0,
    launchAngleRad,
  });
}
