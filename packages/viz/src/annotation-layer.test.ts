import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  EnvSample,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import {
  EventCollector,
  TrajectoryRecorder,
  createDormandPrince54Stepper,
  integrate,
  type EventRoot,
  type Trajectory,
} from "@ballista/solverkit";
import { computeAnnotations, type AnnotationSet } from "./annotation-layer.js";

function makeApexEventRoot(x: number, y: number, vy: number): EventRoot {
  return {
    event: { name: "apex", g: (_t: number, _y: Float64Array) => vy },
    t: 1,
    theta: 0.5,
    y: new Float64Array([x, y, 0, vy]),
    g: vy,
    iterations: 1,
    converged: true,
  };
}

function makeTrajectory(rows: readonly (readonly [number, number, number, number])[]): Trajectory {
  const t = new Float64Array(rows.map((_, i) => i));
  const channels = [0, 1, 2, 3].map((c) => new Float64Array(rows.map((row) => row[c]!)));
  return { nSteps: rows.length, t, channels };
}

describe("computeAnnotations: pure logic on synthetic trajectories/events", () => {
  it("empty trajectory: impact and range are null; apex still resolves if an event was given", () => {
    const events = [makeApexEventRoot(5, 10, 0)];
    const annotations = computeAnnotations(makeTrajectory([]), events);
    expect(annotations.apex).toEqual({ label: "apex", x: 5, y: 10 });
    expect(annotations.impact).toBeNull();
    expect(annotations.range).toBeNull();
  });

  it("no apex event: apex is null, impact/range still derive from the trajectory", () => {
    const trajectory = makeTrajectory([
      [0, 0, 10, 5],
      [10, 5, 10, -5],
      [20, 0, 10, -15],
    ]);
    const annotations = computeAnnotations(trajectory, []);
    expect(annotations.apex).toBeNull();
    expect(annotations.impact).toEqual({ label: "impact", x: 20, y: 0 });
    expect(annotations.range).toBe(20);
  });

  it("picks the first apex-named event, ignoring other event kinds", () => {
    const other: EventRoot = {
      event: { name: "ground-impact", g: (_t: number, _y: Float64Array) => 0 },
      t: 0.5,
      theta: 0.5,
      y: new Float64Array([1, 2, 3, 4]),
      g: 0,
      iterations: 1,
      converged: true,
    };
    const events = [other, makeApexEventRoot(7, 12, 0)];
    const trajectory = makeTrajectory([
      [0, 0, 1, 1],
      [1, 0, 1, -1],
    ]);
    const annotations: AnnotationSet = computeAnnotations(trajectory, events);
    expect(annotations.apex).toEqual({ label: "apex", x: 7, y: 12 });
  });

  it("range is negative when impact lands left of launch (e.g. a strong headwind reversal)", () => {
    const trajectory = makeTrajectory([
      [10, 0, -1, 1],
      [5, 0, -1, -1],
    ]);
    const annotations = computeAnnotations(trajectory, []);
    expect(annotations.range).toBe(-5);
  });
});

describe("AnnotationLayer: drag-free range marker matches v0^2*sin(2*theta)/g to 1e-9 (P3.16 validation criterion)", () => {
  it("gravity-only launch/landing at y=0: range and apex height match the closed-form parabola", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0), // drag-free
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);

    const vx0 = 30;
    const vy0 = 40;
    const y0 = new Float64Array([0, 0, vx0, vy0]);

    const sample = new EnvSample();
    env.sample(0, 0, 0, sample);
    const g = sample.g;

    const stepper = createDormandPrince54Stepper();
    const recorder = new TrajectoryRecorder();
    const collector = new EventCollector();
    const report = integrate(
      model,
      ctx,
      y0,
      [0, 100],
      { stepper: stepper.info.id, rtol: 1e-12, atol: 1e-13, maxSteps: 100_000 },
      stepper,
      [recorder, collector],
    );

    expect(report.status).toBe("ok");
    // Terminated by the ground-impact event well before the generous tspan.
    expect(report.tFinal).toBeLessThan(100);

    const annotations = computeAnnotations(recorder.trajectory, collector.events);

    const v0 = Math.hypot(vx0, vy0);
    const theta = Math.atan2(vy0, vx0);
    const expectedRange = (v0 * v0 * Math.sin(2 * theta)) / g;

    expect(annotations.impact).not.toBeNull();
    expect(annotations.range).not.toBeNull();
    expect(Math.abs(annotations.range! - expectedRange)).toBeLessThan(1e-9);

    // Cross-check: apex height above the y0=0 launch matches vy0^2/(2g) exactly (no drag to perturb it).
    expect(annotations.apex).not.toBeNull();
    const expectedApexHeight = (vy0 * vy0) / (2 * g);
    expect(Math.abs(annotations.apex!.y - expectedApexHeight)).toBeLessThan(1e-9);

    // The apex event itself is v_y=0 to Brent's own convergence tolerance -- the
    // reason the marker's position can be trusted to this precision at all.
    const apexRoot = collector.events.find((e) => e.event.name === "apex")!;
    expect(Math.abs(apexRoot.y[3]!)).toBeLessThan(1e-9);
  });
});
