import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { integrate } from "./integrate.js";
import { TrajectoryRecorder, type Trajectory } from "./trajectory-recorder.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/**
 * P2.50: shifting the launch x-position by dx should leave y(t), vx(t),
 * vy(t) -- and every event (ground impact, apex) -- completely untouched,
 * for a wind-free scenario with flat terrain and a non-altitude-dependent
 * environment: nothing in the rhs (drag, gravity) or the ground-impact
 * event (terrain height h(x)=0, independent of x) reads absolute x, and
 * neither y0 nor vx0/vy0 differ between the two runs, so those channels'
 * entire step-by-step recurrence is fed identical inputs throughout --
 * genuinely bit-identical (`toBe`), not just close, verified below.
 *
 * The x-channel itself is NOT asserted bit-identical after subtracting dx.
 * x accumulates as x_new = x_old + (a value that only depends on the vx
 * history, itself bit-identical between runs) -- but x_old differs between
 * runs by dx, and IEEE-754 addition is not associative: (a+dx)+c can round
 * to a different last bit than (a+c)+dx even though both equal the same
 * real number. Measured directly (see the fast-check counterexamples
 * during development, e.g. dx=-1e-6 against an O(1) accumulated x):  a
 * handful of ULPs of drift appear over enough steps. That's a fact about
 * floating-point summation, not a physics bug, so the x-channel is checked
 * to a tight epsilon-scaled tolerance instead of exact equality.
 *
 * A y0-shift is deliberately NOT tested here: flat terrain's ground-impact
 * event is anchored at the fixed height h(x)=0, so shifting y0 changes
 * *when* impact occurs relative to a run that started at the original
 * height -- that would break event-timing equality for a reason unrelated
 * to the x-translation-invariance property this task is about.
 */
describe("translation invariance: shift x0 => shifted trajectory (P2.50)", () => {
  it("y/vx/vy/t bit-identical, x shifted by dx to within a tight floating-point tolerance, over many random wind-free flights", () => {
    // Denormal-magnitude values (~1e-300) lose enough relative floating-point
    // precision that a+dx-dx can differ from a in the last bit or two -- a
    // real IEEE-754 fact, but not a physically meaningful "shift" and not
    // what this property is about. Filtering to 0 or |v| >= 1e-6 keeps the
    // generator over physically sane launch parameters.
    function reasonableMagnitude(min: number, max: number) {
      return fc
        .double({ min, max, noNaN: true, noDefaultInfinity: true })
        .filter((v) => v === 0 || Math.abs(v) >= 1e-6);
    }

    fc.assert(
      fc.property(
        reasonableMagnitude(-100, 100),
        reasonableMagnitude(-1000, 1000),
        reasonableMagnitude(1, 200),
        reasonableMagnitude(-60, 60),
        reasonableMagnitude(0, 60),
        (x0, dx, y0, vx0, vy0) => {
          const env = () =>
            new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
          const params = createSphericalProjectileParams({
            mass: 0.145,
            radius: 0.0366,
            dragCoefficient: new ConstantCd(0.5),
          });

          function run(startX: number): Trajectory {
            const ctx = createEvalContext(env(), params);
            const model = createPlanarProjectileModel([
              new GravityForce(),
              new QuadraticDragForce(),
            ]);
            const y0State = new Float64Array([startX, y0, vx0, vy0]);
            const recorder = new TrajectoryRecorder();
            integrate(
              model,
              ctx,
              y0State,
              [0, 20],
              { stepper: "classical-rk4", h: 0.01, maxSteps: 100000 },
              new ClassicalRK4Stepper(),
              [recorder],
            );
            return recorder.trajectory;
          }

          const base = run(x0);
          const shifted = run(x0 + dx);

          expect(shifted.nSteps).toBe(base.nSteps);
          for (let i = 0; i < base.nSteps; i++) {
            expect(shifted.t[i]).toBe(base.t[i]);
            expect(shifted.channels[Y]![i]).toBe(base.channels[Y]![i]);
            expect(shifted.channels[VX]![i]).toBe(base.channels[VX]![i]);
            expect(shifted.channels[VY]![i]).toBe(base.channels[VY]![i]);

            const baseX = base.channels[X]![i]!;
            const shiftedX = shifted.channels[X]![i]!;
            const scale = Math.abs(dx) + Math.abs(baseX) + Math.abs(shiftedX) + 1;
            // Bound scales with step count (up to ~2000 here, t in [0,20] at h=0.01): each
            // accepted step's x-update is one more rounding opportunity, so worst-case ULP
            // drift grows with i, not just a fixed handful -- a flat constant (64, this
            // test's original bound) was tight enough to occasionally fail on an unlucky
            // fast-check draw (observed empirically: a handful of runs in ~20 exceeded it by
            // <1%). i+1 keeps the bound tiny in absolute terms (well under 1e-11 even at
            // i=2000) while giving enough headroom that legitimate rounding accumulation over
            // the full flight no longer trips a false positive.
            expect(Math.abs(shiftedX - dx - baseX)).toBeLessThanOrEqual(
              64 * Number.EPSILON * scale * (i + 1),
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
