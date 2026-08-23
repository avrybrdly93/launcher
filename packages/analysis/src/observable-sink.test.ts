import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  FlatTerrain,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import {
  ClassicalRK4Stepper,
  EventCollector,
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  createDormandPrince54Stepper,
  integrate,
  type SolverConfig,
  type Trajectory,
} from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { ObservableSink } from "./observable-sink.js";
import {
  PLANAR_LAYOUT,
  SPATIAL_LAYOUT,
  apexHeight,
  apexTime,
  impactPoint,
  impactSpeed,
  range,
  timeOfFlight,
} from "./observables.js";

/**
 * P6.04's sink is not a second implementation of the observables, it is the
 * same arithmetic run incrementally, so the test that matters is *exact*
 * agreement with `observables.ts` on the same solve. Every comparison below
 * uses `Object.is`, not a tolerance: a tolerance would let the two drift
 * apart by a little and keep passing, which is precisely the failure mode a
 * streaming reimplementation has.
 *
 * The trajectory is recorded *alongside* the sink in the same `integrate`
 * call rather than in a second one, so there is no question of the two
 * having seen different rows.
 */

interface Case {
  readonly name: string;
  readonly v0: number;
  readonly thetaDeg: number;
  readonly y0: number;
  readonly cd: number;
}

function fixture(cd: number): { model: Model; ctx: EvalContext } {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(G_STD, false),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(cd),
  });
  const forces = cd === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return { model: createPlanarProjectileModel(forces), ctx: createEvalContext(env, params) };
}

const CONFIG: SolverConfig = {
  stepper: "dopri5",
  h: 0.05,
  rtol: 1e-11,
  atol: 1e-12,
  maxSteps: 200_000,
};

/** Runs one case with a recorder and a sink attached to the *same* solve. */
function solve(c: Case): { traj: Trajectory; sink: ObservableSink } {
  const { model, ctx } = fixture(c.cd);
  const theta = (c.thetaDeg * Math.PI) / 180;
  const y0 = new Float64Array([0, c.y0, c.v0 * Math.cos(theta), c.v0 * Math.sin(theta)]);
  const stepper = createDormandPrince54Stepper();
  const recorder = new TrajectoryRecorder();
  const sink = new ObservableSink(PLANAR_LAYOUT);

  const report = integrate(model, ctx, y0, [0, 200], CONFIG, stepper, [recorder, sink]);
  expect(report.status).toBe("ok");
  return { traj: recorder.trajectory, sink };
}

const CASES: readonly Case[] = [
  { name: "drag-free 45 deg from the ground", v0: 50, thetaDeg: 45, y0: 0, cd: 0 },
  { name: "drag-free low 20 deg arc", v0: 80, thetaDeg: 20, y0: 0, cd: 0 },
  { name: "drag-free raised launch, 35 deg from 100 m", v0: 60, thetaDeg: 35, y0: 100, cd: 0 },
  { name: "with quadratic drag, 45 deg", v0: 90, thetaDeg: 45, y0: 0, cd: 0.47 },
  { name: "with quadratic drag, steep 75 deg", v0: 60, thetaDeg: 75, y0: 5, cd: 0.47 },
  // A downward launch has no interior apex crossing at all, so the apex is
  // its launch point and the endpoint-candidate branch is the only one that
  // can produce it. Streaming that case wrong is easy and silent.
  { name: "downward launch, no interior apex", v0: 40, thetaDeg: -20, y0: 150, cd: 0.47 },
  // A near-vertical shot puts the apex crossing in a single very short step,
  // which is where the Hermite refinement (rather than a row-wise maximum)
  // is doing the work.
  { name: "near-vertical 89 deg", v0: 45, thetaDeg: 89, y0: 0, cd: 0.47 },
];

describe("P6.04 ObservableSink agrees exactly with observables.ts", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const { traj, sink } = solve(c);
      const got = sink.observables;

      it("time of flight is bit-identical", () => {
        expect(Object.is(got.timeOfFlight, timeOfFlight(traj))).toBe(true);
      });

      it("range is bit-identical", () => {
        expect(Object.is(got.range, range(traj, PLANAR_LAYOUT))).toBe(true);
      });

      it("apex height is bit-identical", () => {
        expect(Object.is(got.apexHeight, apexHeight(traj, PLANAR_LAYOUT))).toBe(true);
      });

      it("apex time is bit-identical", () => {
        expect(Object.is(got.apexTime, apexTime(traj, PLANAR_LAYOUT))).toBe(true);
      });

      it("impact speed is bit-identical", () => {
        expect(Object.is(got.impactSpeed, impactSpeed(traj, PLANAR_LAYOUT))).toBe(true);
      });

      it("impact point is bit-identical", () => {
        expect(got.impactPoint).toEqual(impactPoint(traj, PLANAR_LAYOUT));
      });

      it("reports the solve's own status rather than assuming an impact", () => {
        expect(got.status).toBe("ok");
      });
    });
  }
});

/**
 * The two cases `observables.ts` names as the ones a first-crossing-only
 * scan gets wrong, and which the arcs above cannot reach: a bouncing
 * trajectory whose later arcs each have their own apex, and a solve cut off
 * while still climbing, whose apex *is* its final row.
 *
 * They are here because they are the two that grade the streaming logic
 * rather than the arithmetic. Injecting "accept upward crossings too" and
 * "drop the final-row endpoint candidate" into the sink leaves every case
 * above passing, and fails these.
 */
describe("P6.04 ObservableSink on the arcs that grade the scan itself", () => {
  it("matches apex exactly on a bouncing trajectory, where later arcs each have an apex", () => {
    const env = new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(G_STD, false),
      new ZeroWind(),
    );
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    // e = 0.8 keeps several bounces inside the horizon, each with a smaller
    // apex than the last -- so the *first* arc holds the maximum and a scan
    // that also accepted upward crossings would find a spurious lower one.
    const model = createPlanarProjectileModel([new GravityForce()], new FlatTerrain(), {
      e: 0.8,
      muF: 1,
    });
    const ctx = createEvalContext(env, params);
    const stepper = createDormandPrince54Stepper();
    const recorder = new TrajectoryRecorder();
    const sink = new ObservableSink(PLANAR_LAYOUT);
    const events = new EventCollector();

    integrate(model, ctx, new Float64Array([0, 0, 20, 40]), [0, 30], CONFIG, stepper, [
      recorder,
      sink,
      events,
    ]);

    const traj = recorder.trajectory;
    // The fixture has to actually bounce, or it grades nothing.
    expect(events.events.length).toBeGreaterThan(3);
    expect(Object.is(sink.observables.apexHeight, apexHeight(traj, PLANAR_LAYOUT))).toBe(true);
    expect(Object.is(sink.observables.apexTime, apexTime(traj, PLANAR_LAYOUT))).toBe(true);
  });

  it("reports flight duration, not clock reading, when launched at a non-zero epoch", () => {
    // Every other case starts at t = 0, where `t_final - t_0` and `t_final`
    // are the same number and a relative/absolute mix-up is invisible.
    // observables.ts documents time of flight as relative on purpose; this
    // is the case that holds the sink to it. `apexTime`, by contrast, is
    // documented as being on the trajectory's own clock and so stays
    // absolute -- the two differ here, which is the point.
    const EPOCH = 1000;
    const { model, ctx } = fixture(0);
    const stepper = createDormandPrince54Stepper();
    const recorder = new TrajectoryRecorder();
    const sink = new ObservableSink(PLANAR_LAYOUT);

    integrate(model, ctx, new Float64Array([0, 0, 40, 40]), [EPOCH, EPOCH + 200], CONFIG, stepper, [
      recorder,
      sink,
    ]);

    const traj = recorder.trajectory;
    const got = sink.observables;

    expect(Object.is(got.timeOfFlight, timeOfFlight(traj))).toBe(true);
    expect(Object.is(got.apexTime, apexTime(traj, PLANAR_LAYOUT))).toBe(true);
    // Stated absolutely as well as by agreement, so the assertion still
    // means something if both implementations drifted together.
    expect(got.timeOfFlight).toBeLessThan(20);
    expect(got.apexTime).toBeGreaterThan(EPOCH);
  });

  it("matches apex exactly on a solve cut off while still climbing", () => {
    const { model, ctx } = fixture(0);
    const stepper = createDormandPrince54Stepper();
    const recorder = new TrajectoryRecorder();
    const sink = new ObservableSink(PLANAR_LAYOUT);

    // tspan ends long before v_y reaches zero, so there is no interior
    // crossing at all and the apex is the final row -- the endpoint
    // candidate that streaming sees last.
    const report = integrate(
      model,
      ctx,
      new Float64Array([0, 0, 30, 200]),
      [0, 1],
      CONFIG,
      stepper,
      [recorder, sink],
    );

    const traj = recorder.trajectory;
    const yChannel = PLANAR_LAYOUT.position[PLANAR_LAYOUT.vertical]!;
    const vyChannel = PLANAR_LAYOUT.velocity[PLANAR_LAYOUT.vertical]!;
    // Still ascending at the end: this is what makes the final row the apex.
    expect(traj.channels[vyChannel]![traj.nSteps - 1]!).toBeGreaterThan(0);

    expect(Object.is(sink.observables.apexHeight, apexHeight(traj, PLANAR_LAYOUT))).toBe(true);
    expect(Object.is(sink.observables.apexTime, apexTime(traj, PLANAR_LAYOUT))).toBe(true);
    expect(Object.is(sink.observables.apexHeight, traj.channels[yChannel]![traj.nSteps - 1]!)).toBe(
      true,
    );
    // And this is the caveat, asserted rather than only documented: the
    // solve ran out of tspan without ever reaching the ground, and it still
    // reports "ok". `status` cannot tell an impact from an exhausted
    // horizon, so nothing downstream may treat it as if it could.
    expect(sink.observables.status).toBe("ok");
    expect(sink.observables.status).toBe(report.status);
    expect(sink.observables.timeOfFlight).toBeCloseTo(1, 12);
  });
});

describe("P6.04 ObservableSink retains nothing per step", () => {
  /**
   * The whole point of the sink. A long solve and a short one differ by
   * three orders of magnitude in step count; if the sink's footprint tracked
   * that, the 50 MB budget in P6.04's criterion would be a step-count budget
   * in disguise. Measured as retained heap after a forced GC, the same
   * methodology as P1.21's rhs-allocation harness.
   */
  it("holds the same bytes after a 1-step solve and a many-thousand-step solve", () => {
    expect(typeof global.gc).toBe("function");

    // Fixed-step RK4, not the adaptive stepper: with DOPRI5 the configured
    // `h` is only an initial guess and the controller converges both solves
    // to the same few hundred steps, which would make the comparison
    // vacuous. Wrapped in Hermite dense output because terminal event
    // localization needs an interpolant and RK4 has none (mirrors
    // sweep-job.ts).
    const measure = (h: number): { sink: ObservableSink; steps: number } => {
      const { model, ctx } = fixture(0.47);
      const stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
      const sink = new ObservableSink(PLANAR_LAYOUT);
      const y0 = new Float64Array([0, 500, 70, 70]);
      const report = integrate(
        model,
        ctx,
        y0,
        [0, 200],
        { stepper: "rk4", h, maxSteps: 500_000 },
        stepper,
        [sink],
      );
      return { sink, steps: report.nSteps };
    };

    // Warm up so the measurement is not paying for first-call JIT/shape
    // allocation that has nothing to do with either solve's length.
    for (let i = 0; i < 20; i++) measure(0.05);

    // Measured while *holding* many finished sinks rather than one. A single
    // sink's footprint is a few hundred bytes, which is the same order as
    // GC slack between two heapUsed readings -- the earlier draft of this
    // test failed on that noise alone. Holding HELD of them makes the signal
    // linear in HELD while the slack stays constant, so the assertion is
    // about retention rather than about scheduler luck.
    const HELD = 20;
    const holdSinks = (h: number): { sinks: ObservableSink[]; steps: number } => {
      const sinks: ObservableSink[] = [];
      let steps = 0;
      for (let i = 0; i < HELD; i++) {
        const run = measure(h);
        sinks.push(run.sink);
        steps = run.steps;
      }
      return { sinks, steps };
    };

    const short = measure(1);
    global.gc!();
    const before = process.memoryUsage().heapUsed;
    const long = holdSinks(1e-3);
    global.gc!();
    const after = process.memoryUsage().heapUsed;

    // The long solve must genuinely be long, or the comparison is vacuous.
    expect(long.steps).toBeGreaterThan(short.steps * 100);
    expect(short.sink.observables.range).toBeGreaterThan(0);
    for (const sink of long.sinks) expect(sink.observables.range).toBeGreaterThan(0);

    // Retaining rows would cost steps x channels x 8 bytes per sink: at
    // ~200k steps and 4 channels that is ~6.4 MB each, ~128 MB for HELD of
    // them. Retaining nothing per step costs a few hundred bytes each. 1 MB
    // sits two orders of magnitude below the first and far above GC slack,
    // so it separates the two without being a tuned number.
    expect(after - before).toBeLessThan(1024 * 1024);
  });
});

describe("P6.04 ObservableSink error paths", () => {
  it("refuses to be read before the solve finishes", () => {
    const sink = new ObservableSink(PLANAR_LAYOUT);
    expect(() => sink.observables).toThrow(/before finish/);
  });

  it("rejects a layout that spans more channels than the model has", () => {
    const { model, ctx } = fixture(0);
    const stepper = createDormandPrince54Stepper();
    const sink = new ObservableSink(SPATIAL_LAYOUT);
    expect(() =>
      integrate(model, ctx, new Float64Array([0, 10, 5, 5]), [0, 10], CONFIG, stepper, [sink]),
    ).toThrow(/layout spans 6 channel\(s\), but the model has only 4/);
  });

  it("can be reused across solves without carrying the previous one's apex", () => {
    const sink = new ObservableSink(PLANAR_LAYOUT);
    const { model, ctx } = fixture(0);
    const stepper = createDormandPrince54Stepper();

    const run = (vy: number): number => {
      integrate(model, ctx, new Float64Array([0, 0, 30, vy]), [0, 200], CONFIG, stepper, [sink]);
      return sink.observables.apexHeight;
    };

    const tall = run(90);
    const shortArc = run(10);
    // Without `reset`, the tall arc's apex would survive into the short one.
    expect(shortArc).toBeLessThan(tall);
    expect(shortArc).toBeCloseTo((10 * 10) / (2 * G_STD), 6);
  });
});
