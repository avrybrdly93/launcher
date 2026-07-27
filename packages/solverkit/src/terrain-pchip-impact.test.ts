import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  PchipTerrain,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";

/**
 * P4.13 integration-level validation: "impact event solves y=h(x) on
 * slope; grazing case exercised". `terrain.test.ts` already covers
 * `PchipTerrain` as a data model in isolation; these tests drive it through
 * the real event-detection/root-localization stack (`integrate`, §4.9) the
 * way a committed scenario would.
 */
describe("ground-impact event against a PchipTerrain (P4.13)", () => {
  it("localizes ground impact onto a sloped PCHIP terrain: yFinal sits on h(x) to root-finding tolerance", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    // A gentle downward ramp: h(0)=2, h(50)=0, roughly matching the
    // trajectory's own descent so impact happens partway down the slope,
    // not right at a control point.
    const terrain = new PchipTerrain([
      { x: -10, y: 2 },
      { x: 0, y: 2 },
      { x: 25, y: 1 },
      { x: 50, y: 0 },
      { x: 60, y: 0 },
    ]);
    const model = createPlanarProjectileModel([new GravityForce()], terrain);
    const stepper = createDormandPrince54Stepper();

    const y0 = new Float64Array([0, 10, 15, 5]);
    const report = integrate(
      model,
      ctx,
      y0,
      [0, 60],
      { stepper: stepper.info.id, rtol: 1e-9, atol: 1e-12, maxSteps: 10000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    // Terminated by the ground-impact event well before the [0, 60] tspan
    // backstop -- proof it actually stopped at a located root, not by
    // running out of time.
    expect(report.tFinal).toBeLessThan(60);

    const xFinal = report.yFinal[0]!;
    const yFinal = report.yFinal[1]!;
    expect(yFinal).toBeCloseTo(terrain.height(xFinal), 6);
    // Landed on the sloped part of the ramp, not clamped past an endpoint.
    expect(xFinal).toBeGreaterThan(-10);
    expect(xFinal).toBeLessThan(60);
  });

  it("catches a grazing impact hidden inside a single coarse fixed step (same-sign endpoints, dip in between)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    // Drag-off, gravity-only: x(t) = vx0*t, y(t) = y0 + vy0*t - g*t^2/2
    // exactly (closed form), independent of terrain (terrain only feeds
    // the event function, never the dynamics rhs).
    const vx0 = 10;
    const vy0 = 15;
    const y0 = 0;
    const yAt = (t: number) => y0 + vy0 * t - 0.5 * G_STD * t * t;
    const xAt = (t: number) => vx0 * t;

    const h = 0.6; // fixed macro-step
    const kSpikeStep = 2; // step [1.2, 1.8]
    const tStepStart = kSpikeStep * h;
    const tStepEnd = (kSpikeStep + 1) * h;
    const tSpike = 1.5; // strictly inside (tStepStart, tStepEnd)
    expect(tSpike).toBeGreaterThan(tStepStart);
    expect(tSpike).toBeLessThan(tStepEnd);

    const xSpike = xAt(tSpike);
    const ySpike = yAt(tSpike);

    // A narrow spike, entirely inside the [tStepStart, tStepEnd] step's
    // x-range, that pokes up just above the trajectory's height at its
    // peak -- g = y - h dips negative there and only there, while both
    // macro-step endpoints stay comfortably above ground (h=0 elsewhere).
    // The naive endpoint sign check (g(tStepStart)*g(tStepEnd) > 0) cannot
    // see this; only the interior-sample grazing guard can.
    const spikeHalfWidth = 0.05; // x-width; well inside xAt(tStepStart)..xAt(tStepEnd)
    const terrain = new PchipTerrain([
      { x: -1000, y: 0 },
      { x: xSpike - spikeHalfWidth, y: 0 },
      { x: xSpike, y: ySpike + 0.1 },
      { x: xSpike + spikeHalfWidth, y: 0 },
      { x: 1000, y: 0 },
    ]);

    const gAtStepStart = yAt(tStepStart) - terrain.height(xAt(tStepStart));
    const gAtStepEnd = yAt(tStepEnd) - terrain.height(xAt(tStepEnd));
    // Confirms the contrived shape: a naive endpoint-only check would see
    // no sign change across this step and conclude nothing happened.
    expect(gAtStepStart).toBeGreaterThan(0);
    expect(gAtStepEnd).toBeGreaterThan(0);

    const model = createPlanarProjectileModel([new GravityForce()], terrain);
    // Event localization needs dense output (`integrate.ts`: events are
    // silently skipped for a stepper with no `interpolant`); a bare
    // fixed-step `ClassicalRK4Stepper` has none, so wrap it (P2.31's
    // documented pattern for giving any fixed-step method event support).
    const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());

    const naturalFlatLandingTime = (2 * vy0) / G_STD; // ~3.06s if the spike were missed entirely
    const report = integrate(
      model,
      ctx,
      new Float64Array([0, y0, vx0, vy0]),
      [0, naturalFlatLandingTime + 1],
      { stepper: stepper.info.id, h, maxSteps: 1000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    // Caught within the spike's own macro-step, not blown through to the
    // real (flat-ground, far later) landing -- the signature of the
    // grazing guard actually firing rather than being silently skipped.
    expect(report.tFinal).toBeGreaterThan(tStepStart);
    expect(report.tFinal).toBeLessThan(tStepEnd);
    expect(report.tFinal).toBeLessThan(naturalFlatLandingTime - 1);

    const xFinal = report.yFinal[0]!;
    const yFinal = report.yFinal[1]!;
    expect(yFinal).toBeCloseTo(terrain.height(xFinal), 6);
  });
});
