import { describe, expect, it } from "vitest";
import { runEnergyDriftStudy } from "./energy-drift-study.js";
import { DEFAULT_SCENARIO } from "./simulation-session.js";

const METHOD_IDS = ["explicit-euler", "classical-rk4", "semi-implicit-euler", "velocity-verlet"];

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

    const maxAbs = (arr: Float64Array) => Math.max(...Array.from(arr, Math.abs));
    expect(maxAbs(verlet.relativeEnergyError)).toBeLessThan(
      maxAbs(euler.relativeEnergyError) / 100,
    );
  });

  /**
   * P4.12 shape assertions. Verified two ways (closed-form recurrence
   * algebra on the constant-acceleration Hamiltonian H = v^2/2 + g*y, and
   * empirically against these actual runs) that on THIS specific
   * conservative sub-problem -- uniform gravity, i.e. a force that does
   * not depend on position -- explicit Euler's per-step energy bias
   * dE = +g^2*h^2/2 and semi-implicit (symplectic) Euler's is
   * dE = -g^2*h^2/2: equal in magnitude, opposite in sign, and both
   * independent of the current state. So both integrate to *exactly*
   * linear-in-t drift of the same size, not the textbook "explicit grows,
   * symplectic stays bounded" contrast -- that guarantee comes from
   * backward-error analysis's modified-Hamiltonian correction term
   * tracking the *curvature* of the force field, which uniform gravity
   * has none of (confirmed: switching to altitude-dependent gravity, a
   * mild nonlinearity, does not change the picture at ballistic-flight
   * length scales). Symplectic Euler's real advantage -- bounded error
   * under a genuinely position-dependent restoring force (a pendulum, a
   * two-body orbit) -- needs a Stage B model this platform doesn't have
   * yet; velocity Verlet's near-exactness here is a *stronger* fact
   * specific to its symmetric, quadratic-exact recurrence, not evidence
   * that plain symplectic Euler is bounded on this exhibit. See ROADMAP
   * P4.12 notes.
   */
  describe("shape of each method's drift (P4.12)", () => {
    /** error(t)/t at each sample index i>0 -- constant iff the drift is exactly linear-in-t through the origin. */
    function driftRatios(method: {
      readonly t: Float64Array;
      readonly relativeEnergyError: Float64Array;
    }): number[] {
      const ratios: number[] = [];
      for (let i = 1; i < method.t.length; i++) {
        ratios.push(method.relativeEnergyError[i]! / method.t[i]!);
      }
      return ratios;
    }

    it("explicit Euler drifts linearly in time: error(t)/t is a nonzero constant across the run", () => {
      const study = runEnergyDriftStudy();
      const euler = study.methods.find((m) => m.stepperId === "explicit-euler")!;
      const ratios = driftRatios(euler);

      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(Math.abs(mean)).toBeGreaterThan(1e-6);
      for (const r of ratios) {
        expect(r).toBeCloseTo(mean, 3);
      }
    });

    it("semi-implicit (symplectic) Euler mirrors explicit Euler's linear drift exactly (opposite sign, equal magnitude) on this position-independent force", () => {
      const study = runEnergyDriftStudy();
      const euler = study.methods.find((m) => m.stepperId === "explicit-euler")!;
      const symplecticEuler = study.methods.find((m) => m.stepperId === "semi-implicit-euler")!;

      const meanRatio = (m: typeof euler) => {
        const r = driftRatios(m);
        return r.reduce((a, b) => a + b, 0) / r.length;
      };
      const eulerRatio = meanRatio(euler);
      const symplecticRatio = meanRatio(symplecticEuler);

      expect(Math.sign(symplecticRatio)).toBe(-Math.sign(eulerRatio));
      expect(Math.abs(symplecticRatio)).toBeCloseTo(Math.abs(eulerRatio), 6);
    });

    it("classical RK4 and velocity Verlet stay within a tiny, non-growing bound throughout (both integrate this constant-acceleration trajectory to within floating-point roundoff)", () => {
      const study = runEnergyDriftStudy();
      const maxAbs = (arr: Float64Array) => Math.max(...Array.from(arr, Math.abs));

      for (const id of ["classical-rk4", "velocity-verlet"]) {
        const method = study.methods.find((m) => m.stepperId === id)!;
        expect(maxAbs(method.relativeEnergyError)).toBeLessThan(1e-8);

        // Not growing: error late in the run isn't systematically larger
        // than error early in the run (unlike Euler/symplectic-Euler's
        // strictly linear-in-t growth above).
        const n = method.relativeEnergyError.length;
        const firstQuarter = method.relativeEnergyError.slice(0, Math.floor(n / 4));
        const lastQuarter = method.relativeEnergyError.slice(Math.floor((3 * n) / 4));
        const meanAbs = (arr: Float64Array) =>
          Array.from(arr, Math.abs).reduce((a, b) => a + b, 0) / arr.length;
        expect(meanAbs(lastQuarter)).toBeLessThan(meanAbs(firstQuarter) * 10 + 1e-9);
      }
    });
  });
});
