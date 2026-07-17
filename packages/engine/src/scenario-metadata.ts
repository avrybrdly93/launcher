import {
  dimensionlessPi,
  machNumber,
  reynoldsNumber,
  type CharacteristicEnvironment,
} from "./characteristic-scales.js";
import { EnvSample } from "./env-sample.js";
import { projectileSpecToParams } from "./projectile-spec.js";
import { environmentSpecToEnvironment, type ScenarioSpec } from "./scenario-spec.js";

/**
 * The nondimensional groups the UI surfaces live (§3.6): Π (drag-to-gravity
 * ratio), Re (Reynolds number), M (Mach number), and S (spin ratio,
 * |ω|R/v0, 0 for spin-free scenarios). All four are evaluated once, at the
 * launch state (t=0, initial position and velocity) -- a fixed reference
 * point independent of any solve, which is what lets the scenario library
 * be organized/tested by these groups rather than by raw parameters.
 */
export interface ScenarioNondimensionalGroups {
  readonly pi: number;
  readonly reynolds: number;
  readonly mach: number;
  readonly spinRatio: number;
}

/** Computes `ScenarioNondimensionalGroups` for a scenario's launch state (§3.6). */
export function scenarioNondimensionalGroups(spec: ScenarioSpec): ScenarioNondimensionalGroups {
  const params = projectileSpecToParams(spec.projectile);
  const environment = environmentSpecToEnvironment(spec.environment);
  const sample = new EnvSample();
  const { x0, y0, vx0, vy0, spin0 } = spec.initialConditions;
  environment.sample(0, x0, y0, sample);

  const v0 = Math.hypot(vx0, vy0);
  const charEnv: CharacteristicEnvironment = {
    rho: sample.rho,
    eta: sample.eta,
    c: sample.c,
    g: sample.g,
  };

  return {
    pi: v0 > 0 ? dimensionlessPi(params, charEnv, v0) : 0,
    reynolds: v0 > 0 ? reynoldsNumber(sample.rho, v0, params.radius, sample.eta) : 0,
    mach: v0 > 0 ? machNumber(v0, sample.c) : 0,
    spinRatio: v0 > 0 ? (Math.abs(spin0 ?? 0) * params.radius) / v0 : 0,
  };
}
