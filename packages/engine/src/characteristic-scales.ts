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
