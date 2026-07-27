import { describe, expect, it } from "vitest";
import {
  GravityForce,
  MagnusForce,
  PROJECTILE_ASSETS,
  QuadraticDragForce,
  createEvalContext,
  createPlanarProjectileModel,
  environmentSpecToEnvironment,
  projectileSpecToParams,
  type EnvironmentSpec,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { integrate } from "./integrate.js";

const TABLE_TENNIS_BALL = PROJECTILE_ASSETS.find((a) => a.id === "table-tennis-ball")!;
if (!TABLE_TENNIS_BALL)
  throw new Error("expected the table-tennis-ball asset in PROJECTILE_ASSETS");

const NO_WIND: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: {},
  wind: { kind: "zero" },
};

/**
 * Same rally-shot launch (matching the table-tennis preset's own launch
 * conditions, scenario-presets.ts) integrated to its apex, with `spin`
 * (rad/s, positive = backspin per §3.6's sign convention) as the only
 * variable -- the "curve comparison preset pair" this task calls for.
 * Returns the localized apex height y(t_apex).
 */
function apexHeight(spin: number): number {
  const model = createPlanarProjectileModel([
    new GravityForce(),
    new QuadraticDragForce(),
    new MagnusForce(),
  ]);
  const env = environmentSpecToEnvironment(NO_WIND);
  const params = projectileSpecToParams(TABLE_TENNIS_BALL, spin);
  const ctx = createEvalContext(env, params);

  const y0 = new Float64Array([0, 0.76, 11.28, 3.16]); // matches the TABLE_TENNIS preset's launch
  const stepper = createDormandPrince54Stepper();
  const events = new EventCollector();

  const report = integrate(
    model,
    ctx,
    y0,
    [0, 5],
    { stepper: stepper.info.id, rtol: 1e-10, atol: 1e-10, maxSteps: 100_000 },
    stepper,
    [events],
  );

  expect(report.status).toBe("ok");
  const apex = events.events.find((e) => e.event.name === "apex");
  if (!apex) throw new Error(`no apex event recorded for spin=${spin}`);
  return apex.y[1]!;
}

/**
 * P4.09 validation criterion ("trajectories diverge as theory predicts,
 * sign test on apex"): §3.6 states plainly that backspin lifts and topspin
 * dives (eq. 3.15/3.18, "signs shown for ω̂=±ê_z"). For the identical
 * launch, backspin's Magnus force adds upward lift through the ascent
 * (raising the apex above the no-spin baseline) while topspin's flips that
 * same term negative (pulling the apex below baseline) -- so the ordering
 * apex(topspin) < apex(no-spin) < apex(backspin) is the theory's literal
 * sign prediction, checked directly rather than inferred from a single
 * pairwise comparison.
 */
describe("topspin/backspin curve-comparison exhibit (P4.09, §3.6)", () => {
  it("backspin apex > no-spin apex > topspin apex, for an identical launch", () => {
    const backspinApex = apexHeight(150);
    const noSpinApex = apexHeight(0);
    const topspinApex = apexHeight(-150);

    expect(backspinApex).toBeGreaterThan(noSpinApex);
    expect(noSpinApex).toBeGreaterThan(topspinApex);
  });

  it("holds at a smaller spin magnitude too (not an artifact of one specific spin rate)", () => {
    const noSpinApex = apexHeight(0);
    expect(apexHeight(50)).toBeGreaterThan(noSpinApex);
    expect(apexHeight(-50)).toBeLessThan(noSpinApex);
  });
});
