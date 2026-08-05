import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createKeplerModel,
  createSphericalProjectileParams,
  keplerAngularMomentum,
  keplerEnergy,
} from "@ballista/engine";
import type { EvalContext, Model } from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createStepResult } from "./types.js";
import { VerletStepper } from "./verlet-stepper.js";
import type { Stepper } from "./types.js";

/**
 * P4.33's validation criterion: on an *eccentric* Kepler orbit, classical RK4
 * drifts secularly in energy while velocity Verlet stays bounded.
 *
 * Why eccentric and not circular: on a circular orbit the speed and radius
 * never change, so the local truncation error is the same at every step and
 * RK4's energy error largely cancels around the loop -- the drift is there but
 * takes far longer to separate from the oscillation. Eccentricity is what
 * makes the test sharp: the periapsis passage is a short, fast, high-curvature
 * arc where a fixed step size is locally much too coarse, and the error it
 * deposits there does *not* cancel over the rest of the orbit. That is exactly
 * the regime where a symplectic method's bounded-error property earns its
 * keep, so it is the honest place to compare.
 *
 * The distinction being asserted is qualitative, not "Verlet is more
 * accurate". Verlet is order 2 and RK4 is order 4, and per step RK4 is far
 * more accurate here -- its *instantaneous* energy error is much smaller. The
 * claim is about the structure of the error over many orbits: RK4's
 * accumulates in one direction (secular), Verlet's oscillates about zero with
 * a ceiling set by h (bounded). See verlet-stepper.derivation.md for the
 * backward-error-analysis argument.
 *
 * Angular momentum is the control in the comparison: it is conserved because
 * the force is *central*, not because of Hamiltonian structure, so both
 * integrators should hold it well. If a change ever breaks both invariants at
 * once, that points at the model, not at the symplectic story.
 *
 * Integrator discipline (standing constraint): the Kepler two-body problem is
 * conservative -- no drag, no damping, no dissipative path anywhere in it --
 * which is the precondition for applying a symplectic integrator at all. This
 * test does not extend symplectic integration to any dissipative system.
 */
describe("Kepler eccentric orbit: RK4 drifts, Verlet bounded (P4.33)", () => {
  const MU = 3.986e14; // m^3/s^2
  const A = 1e7; // semi-major axis, m
  const E = 0.6; // eccentricity -- genuinely eccentric, r varies 4e6..1.6e7 m

  /**
   * The Kepler model's rhs ignores `EvalContext` entirely (no forces, no
   * environment sampling -- same as the P4.31 pendulum), but `Stepper.init`
   * takes one, so a real, unused context is built rather than a cast.
   */
  function evalContext(): EvalContext {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    return createEvalContext(env, params);
  }

  /** Periapsis state of the (a, e) ellipse: r on +x, velocity tangential (+y). */
  function periapsisState(): Float64Array {
    const r = A * (1 - E);
    const v = Math.sqrt(MU * (2 / r - 1 / A));
    return new Float64Array([r, 0, 0, v]);
  }

  /** Orbital period from Kepler's third law, T = 2*pi*sqrt(a^3/mu). */
  const PERIOD = 2 * Math.PI * Math.sqrt((A * A * A) / MU);

  interface Series {
    /** Relative energy error (E(t) - E0)/|E0| sampled once per step. */
    readonly energyError: number[];
    /** Relative angular-momentum error, same sampling. */
    readonly angMomError: number[];
    /** Minimum radius reached, to confirm the orbit really is eccentric. */
    readonly rMin: number;
    readonly rMax: number;
  }

  function integrate(model: Model, stepper: Stepper, h: number, nSteps: number): Series {
    const ctx = evalContext();
    stepper.init(model, ctx);
    const out = createStepResult(model.dim);

    const y = periapsisState();
    const energy0 = keplerEnergy(y, MU);
    const angMom0 = keplerAngularMomentum(y);

    const energyError: number[] = [];
    const angMomError: number[] = [];
    let rMin = Infinity;
    let rMax = 0;
    let t = 0;

    for (let i = 0; i < nSteps; i++) {
      stepper.step(t, y, h, out);
      y.set(out.yNext);
      t += h;

      energyError.push((keplerEnergy(y, MU) - energy0) / Math.abs(energy0));
      angMomError.push((keplerAngularMomentum(y) - angMom0) / Math.abs(angMom0));
      const r = Math.hypot(y[0]!, y[1]!);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }

    return { energyError, angMomError, rMin, rMax };
  }

  /**
   * Splits a series into `nBins` consecutive blocks and returns each block's
   * mean. A secular drift shows up as a monotone march across these means; a
   * bounded oscillation does not, no matter how large its amplitude.
   */
  function blockMeans(series: readonly number[], nBins: number): number[] {
    const width = Math.floor(series.length / nBins);
    const means: number[] = [];
    for (let b = 0; b < nBins; b++) {
      let sum = 0;
      for (let i = b * width; i < (b + 1) * width; i++) sum += series[i]!;
      means.push(sum / width);
    }
    return means;
  }

  // 60 orbits at 2000 steps per orbit. Long enough for RK4's secular term to
  // dominate its per-step error, short enough to stay a fast unit test.
  const ORBITS = 60;
  const STEPS_PER_ORBIT = 2000;
  const N_STEPS = ORBITS * STEPS_PER_ORBIT;
  const H = PERIOD / STEPS_PER_ORBIT;

  it("the fixture really is an eccentric orbit (radius varies by the expected factor)", () => {
    const series = integrate(createKeplerModel(MU), new VerletStepper("velocity"), H, N_STEPS);
    // Apoapsis/periapsis ratio for e=0.6 is (1+e)/(1-e) = 4.
    expect(series.rMin / (A * (1 - E))).toBeCloseTo(1, 1);
    expect(series.rMax / (A * (1 + E))).toBeCloseTo(1, 1);
    expect(series.rMax / series.rMin).toBeGreaterThan(3.5);
  });

  it("RK4 energy error is secular: block means march linearly and the error band separates", () => {
    const { energyError } = integrate(createKeplerModel(MU), new ClassicalRK4Stepper(), H, N_STEPS);
    const means = blockMeans(energyError, 6);

    // Monotone in magnitude and never reversing sign: the signature of drift.
    // (Measured: -9.30e-10 -> -4.26e-9 across the six blocks, all negative --
    // RK4 loses energy on this orbit.)
    for (let i = 1; i < means.length; i++) {
      expect(Math.abs(means[i]!)).toBeGreaterThan(Math.abs(means[i - 1]!));
      expect(Math.sign(means[i]!)).toBe(Math.sign(means[0]!));
    }

    // Stronger than monotonicity: the growth is *linear in time*, the defining
    // shape of a secular term. Consecutive block-mean increments are equal to
    // within 5% of their average (measured: ~6.66e-10 per block, near-constant).
    const increments = means.slice(1).map((m, i) => m - means[i]!);
    const meanIncrement = increments.reduce((a, b) => a + b, 0) / increments.length;
    for (const inc of increments) {
      expect(Math.abs(inc / meanIncrement - 1)).toBeLessThan(0.05);
    }

    // And the sharpest statement of drift available: the entire last orbit's
    // error band lies strictly outside the entire first orbit's. There is no
    // overlap at all -- the error has not merely oscillated wider, it has
    // moved. (Measured: first orbit spans [-6.59e-10, -1.0e-12], last orbit
    // spans [-4.59e-9, -3.93e-9].)
    const firstOrbit = energyError.slice(0, STEPS_PER_ORBIT);
    const lastOrbit = energyError.slice(-STEPS_PER_ORBIT);
    expect(Math.max(...lastOrbit)).toBeLessThan(Math.min(...firstOrbit));
  });

  it("Verlet energy error is bounded: the late-orbit band is indistinguishable from the first", () => {
    const { energyError } = integrate(
      createKeplerModel(MU),
      new VerletStepper("velocity"),
      H,
      N_STEPS,
    );

    const band = (slice: readonly number[]): number => Math.max(...slice.map((v) => Math.abs(v)));
    const firstOrbit = band(energyError.slice(0, STEPS_PER_ORBIT));
    const lastOrbit = band(energyError.slice(-STEPS_PER_ORBIT));

    // The error envelope has not grown after 60 orbits -- within 1%, and in
    // practice to 5+ significant figures (measured: 7.3134e-5 for both). This
    // is the bounded-error property, and it is exactly what RK4 above fails.
    expect(lastOrbit / firstOrbit).toBeCloseTo(1, 2);

    // Block means do not march: all six agree to within 1% of each other, the
    // direct contrast with RK4's near-constant nonzero increment above.
    const means = blockMeans(energyError, 6);
    expect(Math.max(...means) / Math.min(...means)).toBeCloseTo(1, 2);

    // "Bounded" must not pass vacuously on a flat series: the error genuinely
    // oscillates within each orbit, swinging from essentially zero up to the
    // full band and back (measured: [1.1e-9, 7.3e-5] over the first orbit).
    // Note it is one-signed here rather than symmetric about zero -- velocity
    // Verlet's energy error on this orbit rides in a band offset from zero,
    // which is still bounded, which is all the property claims.
    expect(Math.min(...energyError.slice(0, STEPS_PER_ORBIT))).toBeLessThan(0.01 * firstOrbit);
    expect(Math.max(...energyError.slice(0, STEPS_PER_ORBIT))).toBeGreaterThan(0.5 * firstOrbit);
  });

  it("Verlet's bounded error is larger than RK4's drifting one: this is structure, not accuracy", () => {
    const rk4 = integrate(createKeplerModel(MU), new ClassicalRK4Stepper(), H, N_STEPS);
    const verlet = integrate(createKeplerModel(MU), new VerletStepper("velocity"), H, N_STEPS);

    const band = (s: readonly number[]): number => Math.max(...s.map((v) => Math.abs(v)));

    // Order 4 beats order 2 on raw magnitude by ~4 orders of magnitude here,
    // even after 60 orbits (measured: RK4 4.59e-9 vs Verlet 7.31e-5). Asserting
    // this keeps the comparison honest: the task's claim is about the *shape*
    // of the error over time, not about Verlet being the more accurate method.
    expect(band(rk4.energyError)).toBeLessThan(band(verlet.energyError));

    // The property that does separate them, stated as a ratio of the whole
    // run's band to the first orbit's. For RK4 the run is far worse than its
    // first orbit (the error kept growing); for Verlet the first orbit already
    // contains the whole run's band.
    //
    // Deliberately *not* asserted via "where does the global max occur":
    // Verlet's band is flat to ~5 significant figures across all 60 orbits, so
    // the argmax is decided by last-bit noise and lands in an arbitrary orbit
    // (measured: step 87843, orbit 44). The ratio below is the same claim
    // without depending on a tie-break.
    const firstOrbitBand = (s: readonly number[]): number => band(s.slice(0, STEPS_PER_ORBIT));
    expect(band(rk4.energyError) / firstOrbitBand(rk4.energyError)).toBeGreaterThan(5);
    expect(band(verlet.energyError) / firstOrbitBand(verlet.energyError)).toBeCloseTo(1, 2);
  });

  it("both integrators hold angular momentum: it comes from centrality, not symplecticity", () => {
    for (const stepper of [new ClassicalRK4Stepper(), new VerletStepper("velocity")]) {
      const { angMomError } = integrate(createKeplerModel(MU), stepper, H, N_STEPS);
      const worst = Math.max(...angMomError.map((v) => Math.abs(v)));
      expect(worst).toBeLessThan(1e-9);
    }
  });
});
