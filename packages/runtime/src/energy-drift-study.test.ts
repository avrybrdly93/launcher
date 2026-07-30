import { describe, expect, it } from "vitest";
import { runEnergyDriftStudy, type EnergyDriftMethodTrace } from "./energy-drift-study.js";
import { DEFAULT_SCENARIO } from "./simulation-session.js";

const METHOD_IDS = ["explicit-euler", "classical-rk4", "semi-implicit-euler", "velocity-verlet"];

function trace(study: ReturnType<typeof runEnergyDriftStudy>, id: string): EnergyDriftMethodTrace {
  return study.methods.find((m) => m.stepperId === id)!;
}

function maxAbs(arr: Float64Array): number {
  let m = 0;
  for (const v of arr) if (Math.abs(v) > m) m = Math.abs(v);
  return m;
}

/**
 * Pearson correlation between `t` and `|relativeEnergyError|` (skipping the
 * t=0 sample, which is exactly 0 by construction and would just dilute a
 * trend signal, not represent one). A value near +1 is the numeric
 * signature of "grows essentially linearly with t"; a value near 0 is the
 * signature of "no time trend" (bounded oscillation or flat noise).
 */
function trendCorrelation(method: EnergyDriftMethodTrace): number {
  const t = Array.from(method.t).slice(1);
  const err = Array.from(method.relativeEnergyError).slice(1).map(Math.abs);
  const n = t.length;
  const mt = t.reduce((a, b) => a + b, 0) / n;
  const me = err.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vt = 0;
  let ve = 0;
  for (let i = 0; i < n; i++) {
    const dt = t[i]! - mt;
    const de = err[i]! - me;
    cov += dt * de;
    vt += dt * dt;
    ve += de * de;
  }
  return cov / Math.sqrt(vt * ve);
}

describe("runEnergyDriftStudy (P3.44)", () => {
  it("produces one trace per flagship method, each a genuine pinned run with a finite E(t)/E(0)-1 series starting at 0", () => {
    const study = runEnergyDriftStudy();

    expect(study.tFinal).toBeGreaterThan(0);
    expect(study.methods).toHaveLength(4);
    expect(study.methods.map((m) => m.stepperId)).toEqual(METHOD_IDS);

    for (const method of study.methods) {
      expect(method.t.length).toBeGreaterThan(1);
      expect(method.relativeEnergyError.length).toBe(method.t.length);
      expect(method.t[0]).toBe(0);
      // First recorded row is the initial condition itself, so its
      // relative error against E(0) is exactly 0 -- not just "small".
      expect(method.relativeEnergyError[0]).toBe(0);
      expect(method.t.at(-1)!).toBeCloseTo(study.tFinal, 6);

      for (let i = 0; i < method.relativeEnergyError.length; i++) {
        expect(Number.isFinite(method.relativeEnergyError[i]!)).toBe(true);
      }
    }
  });

  it("holds every method to the same fixed rhs-evaluation budget (§4.8's 'equal RHS evaluations')", () => {
    const study = runEnergyDriftStudy();
    const rhsCounts = study.methods.map((m) => m.nRHS);

    // Fixed-step, no rejections: nRHS is exactly nSteps * rhsPerStep for
    // every method, so all four land on the same total by construction.
    expect(new Set(rhsCounts).size).toBe(1);
    expect(rhsCounts[0]).toBeGreaterThan(0);
  });

  it("flags the geometric methods (and only those) as symplectic", () => {
    const study = runEnergyDriftStudy();
    const symplecticIds = study.methods.filter((m) => m.symplectic).map((m) => m.stepperId);
    expect(symplecticIds).toEqual(["semi-implicit-euler", "velocity-verlet"]);
  });

  it("defaults to DEFAULT_SCENARIO (gravity-only) when no scenario is passed", () => {
    const withDefault = runEnergyDriftStudy();
    const explicit = runEnergyDriftStudy(DEFAULT_SCENARIO);
    expect(withDefault.tFinal).toBe(explicit.tFinal);
  });

  it("velocity Verlet stays far closer to exact energy conservation than explicit Euler on this constant-gravity exhibit", () => {
    // Constant acceleration means velocity Verlet's discrete recurrence
    // reproduces the closed-form quadratic trajectory exactly, so its
    // drift is essentially floating-point noise, while explicit Euler's
    // is a real O(h) per-step energy error that accumulates secularly.
    const study = runEnergyDriftStudy();
    const euler = study.methods.find((m) => m.stepperId === "explicit-euler")!;
    const verlet = study.methods.find((m) => m.stepperId === "velocity-verlet")!;

    expect(maxAbs(verlet.relativeEnergyError)).toBeLessThan(
      maxAbs(euler.relativeEnergyError) / 100,
    );
  });

  // Task P4.12's validation criterion, per §4.8 and ROADMAP.json: "Euler
  // linear growth, RK4 secular tiny, sympl. Euler/Verlet bounded" -- the
  // four asserts below encode the *actual, measured* shape of each trace on
  // `DEFAULT_SCENARIO` (a single unbounded gravity-only ballistic arc, no
  // bounce). Three of the four match the criterion's shorthand exactly.
  // The fourth -- semi-implicit (symplectic) Euler -- provably does *not*
  // show bounded sawtooth on this particular scenario, for a documented
  // reason (see the note on that assertion below), so its test encodes the
  // true behavior rather than force a false "bounded" pass.
  describe("P4.12 shape asserts", () => {
    it("explicit Euler: |E(t)/E(0)-1| grows essentially linearly with t", () => {
      const study = runEnergyDriftStudy();
      const euler = trace(study, "explicit-euler");

      // A near-+1 correlation between t and |error| is the numeric
      // signature of linear growth from a near-zero start.
      expect(trendCorrelation(euler)).toBeGreaterThan(0.99);

      const err = Array.from(euler.relativeEnergyError, Math.abs);
      const n = err.length;
      const firstQuarterMax = Math.max(...err.slice(1, Math.floor(n / 4)));
      const lastQuarterMax = Math.max(...err.slice(Math.floor((3 * n) / 4)));
      expect(lastQuarterMax).toBeGreaterThan(firstQuarterMax * 2);
    });

    it("classical RK4: stays tiny -- essentially machine-precision noise, orders of magnitude below Euler", () => {
      // RK4 is 4th order and this scenario's exact solution is a degree-2
      // polynomial in t (constant acceleration), which RK4 integrates
      // exactly (it reproduces polynomials up to degree 4) -- so on this
      // particular scenario there is no real O(h^4) truncation term to be
      // "secular" about, only floating-point roundoff. "Tiny" is the load-
      // bearing part of the validation criterion here; asserting a genuine
      // trend on pure roundoff noise would be flaky, not more correct.
      const study = runEnergyDriftStudy();
      const euler = trace(study, "explicit-euler");
      const rk4 = trace(study, "classical-rk4");

      const rk4Max = maxAbs(rk4.relativeEnergyError);
      expect(rk4Max).toBeLessThan(1e-9);
      expect(rk4Max).toBeLessThan(maxAbs(euler.relativeEnergyError) * 1e-6);
    });

    it("velocity Verlet: stays bounded at machine precision, never trending with t", () => {
      const study = runEnergyDriftStudy();
      const verlet = trace(study, "velocity-verlet");

      expect(maxAbs(verlet.relativeEnergyError)).toBeLessThan(1e-9);
    });

    it("semi-implicit (symplectic) Euler: on this scenario its drift is linear like explicit Euler's, not bounded -- gravity is q-independent so there is no periodic recurrence for the shadow-Hamiltonian argument to exploit", () => {
      // This mirrors `semi-implicit-euler-stepper.derivation.md`'s own
      // documented caveat: "a linear potential like pure uniform gravity
      // has no periodic recurrence for the shadow-Hamiltonian argument to
      // exploit, which is why this platform demonstrates the
      // bounded-sawtooth energy behavior on an oscillator fixture rather
      // than a single unbounded ballistic arc" (see that stepper's own test
      // file for the bounded-sawtooth demonstration on a harmonic
      // oscillator). Concretely: for q-independent constant acceleration,
      // symplectic Euler's position update q_{k+1}=q_k+h*v_{k+1} is a
      // right-Riemann sum of the (monotonically changing) velocity, which
      // has a *systematic*, not oscillating, bias of the same asymptotic
      // order as explicit Euler's -- confirmed here rather than merely
      // asserted "bounded" without evidence.
      const study = runEnergyDriftStudy();
      const euler = trace(study, "explicit-euler");
      const symplecticEuler = trace(study, "semi-implicit-euler");

      expect(trendCorrelation(symplecticEuler)).toBeGreaterThan(0.99);

      const eulerMax = maxAbs(euler.relativeEnergyError);
      const symplecticMax = maxAbs(symplecticEuler.relativeEnergyError);
      expect(symplecticMax).toBeGreaterThan(eulerMax * 0.1);
      expect(symplecticMax).toBeLessThan(eulerMax * 10);
    });
  });
});
