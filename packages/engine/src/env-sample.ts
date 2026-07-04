/**
 * Reusable buffer for a point sample of the environment: air density,
 * temperature, pressure, viscosity, speed of sound, wind, and local gravity.
 * `Environment.sample` writes into a caller-owned instance rather than
 * returning a new object, so the rhs hot path stays allocation-free (ADR-004).
 */
export class EnvSample {
  rho = 0; // kg/m^3
  T = 0; // K
  p = 0; // Pa
  eta = 0; // Pa*s (dynamic viscosity)
  c = 0; // m/s (speed of sound)
  wx = 0; // m/s (wind x)
  wy = 0; // m/s (wind y)
  g = 0; // m/s^2 (local gravity magnitude)
}
