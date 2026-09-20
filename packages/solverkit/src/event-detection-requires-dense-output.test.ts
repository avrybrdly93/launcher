import { describe, expect, it } from "vitest";
import type { Model } from "@ballista/engine";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { HeunRK2Stepper } from "./heun-rk2-stepper.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";
import { MidpointRK2Stepper } from "./midpoint-rk2-stepper.js";
import type { SolverEventMode, Stepper } from "./types.js";

/**
 * P0.99 / ADR-016 -- THIS IS NOW THE SPECIFICATION. It was a characterization
 * file pinning the defect; the defect is fixed and the file is rewritten
 * rather than deleted, as ADR-016 required.
 *
 * The bug: `integrate` folded "the stepper exposes an interpolant" into its
 * `hasEvents` predicate, so a model that declared events, integrated with a
 * stepper that could not localize them, integrated as though it had declared
 * none -- no warning, no failure, `status: "ok"`, projectile through the
 * ground. The measured numbers are below and are still asserted, because the
 * behaviour did not become wrong; it became OPT-IN. What changed is that no
 * caller reaches it by accident any more.
 *
 * The fix is an API change, not a guard change, for the reason ADR-016
 * recorded: two callers with the same model and the same fixed-step stepper
 * legitimately want opposite things, and the old signature could not tell
 * them apart. `cfg.events` supplies the intent and has no default.
 */

/** Drag-free planar model. `createPlanarProjectileModel` always attaches a ground-impact event. */
function setup() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()]);
  return { ctx, model };
}

/** The exact configuration recorded in P0.99's repro. */
const Y0 = () => new Float64Array([0, 5, 3, 0]);
const TSPAN: readonly [number, number] = [0, 12];
const H = 0.12;

/** Closed-form impact time for the repro: drag-free from y = 5 with v_y = 0. */
const T_IMPACT_EXACT = Math.sqrt((2 * 5) / 9.80665);

function run(stepper: Stepper, events?: SolverEventMode, collector?: EventCollector) {
  const { ctx, model } = setup();
  return integrate(
    model,
    ctx,
    Y0(),
    TSPAN,
    { stepper: stepper.info.id, h: H, maxSteps: 5000, ...(events ? { events } : {}) },
    stepper,
    collector ? [collector] : [],
  );
}

const fixedStepSteppers: readonly [string, () => Stepper][] = [
  ["ClassicalRK4Stepper", () => new ClassicalRK4Stepper()],
  ["ExplicitEulerStepper", () => new ExplicitEulerStepper()],
  ["HeunRK2Stepper", () => new HeunRK2Stepper()],
  ["MidpointRK2Stepper", () => new MidpointRK2Stepper()],
];

describe("integrate: cfg.events supplies the intent the stepper choice used to decide (P0.99)", () => {
  describe("a stepper with its own interpolant is unaffected", () => {
    it("DOPRI5 stops at the terminal ground impact with cfg.events unset, exactly as before", () => {
      const collector = new EventCollector();
      const report = run(createDormandPrince54Stepper(), undefined, collector);

      expect(report.status).toBe("ok");
      expect(report.tFinal).toBeCloseTo(1.00981, 5);
      expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-9);
      expect(collector.events.length).toBeGreaterThanOrEqual(1);
    });

    it('DOPRI5 with events: "require" is identical -- nothing is wrapped, there is nothing to add', () => {
      const bare = run(createDormandPrince54Stepper(), undefined);
      const required = run(createDormandPrince54Stepper(), "require");

      expect(required.tFinal).toBe(bare.tFinal);
      expect(Array.from(required.yFinal)).toEqual(Array.from(bare.yFinal));
      // The Hermite wrapper costs ~1 extra rhs call/step; an unchanged count
      // is the discriminating evidence that no wrapping happened here.
      expect(required.nRHS).toBe(bare.nRHS);
    });

    it('DOPRI5 with events: "off" integrates straight through the ground, on request', () => {
      const collector = new EventCollector();
      const report = run(createDormandPrince54Stepper(), "off", collector);

      expect(report.status).toBe("ok");
      expect(report.tFinal).toBe(TSPAN[1]);
      expect(report.yFinal[1]!).toBeLessThan(0);
      expect(collector.events).toHaveLength(0);
    });
  });

  describe("THE FIX: a stepper with no interpolant no longer decides silently", () => {
    for (const [name, make] of fixedStepSteppers) {
      it(`${name} + declared events + no intent: throws instead of dropping the events`, () => {
        const stepper = make();
        // Guards the premise: if this stepper ever gains dense output, this
        // line fails rather than the test passing for the wrong reason.
        expect(stepper.interpolant).toBeUndefined();

        expect(() => run(stepper)).toThrow(/has no interpolant/);
      });
    }

    it("the message names every way out, so the throw is actionable without reading the source", () => {
      let message = "";
      try {
        run(new ClassicalRK4Stepper());
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toContain('"require"');
      expect(message).toContain('"off"');
      expect(message).toContain("DOPRI5");
      expect(message).toContain("ADR-016");
      // Says how many events were dropped, not just that some were.
      expect(message).toMatch(/declares \d+ event\(s\)/);
    });

    it("the throw is scoped to the ambiguous case: a model with NO events is unaffected", () => {
      // Same fixed-step stepper, same everything, but nothing is declared, so
      // there is no intent to supply and every value behaves identically.
      const { ctx } = setup();
      const model = createPlanarProjectileModel([new GravityForce()]);
      // The key is omitted rather than set to undefined: the package builds
      // with exactOptionalPropertyTypes, so `events: undefined` is not a Model.
      // `rhs` is forwarded through a closure rather than detached, so the
      // model keeps whatever `this` binding its factory gave it.
      const eventless: Model = {
        dim: model.dim,
        channels: model.channels,
        rhs: (t, y, out, evalCtx) => model.rhs(t, y, out, evalCtx),
      };

      const results = ([undefined, "off", "require"] as const).map((events) =>
        integrate(
          eventless,
          ctx,
          Y0(),
          TSPAN,
          { stepper: "classical-rk4", h: H, maxSteps: 5000, ...(events ? { events } : {}) },
          new ClassicalRK4Stepper(),
        ),
      );

      for (const report of results) {
        expect(report.status).toBe("ok");
        expect(report.tFinal).toBe(TSPAN[1]);
      }
      expect(Array.from(results[1]!.yFinal)).toEqual(Array.from(results[0]!.yFinal));
      expect(Array.from(results[2]!.yFinal)).toEqual(Array.from(results[0]!.yFinal));
    });
  });

  describe('events: "off" -- the old behaviour, kept, but now only on request', () => {
    it("reproduces P0.99's measured numbers exactly: ok, full span, 701 m underground", () => {
      const collector = new EventCollector();
      const report = run(new ClassicalRK4Stepper(), "off", collector);

      // These are the numbers from the bug report and from ADR-016's table.
      // They are asserted so the pre-fix record stays true as the code moves.
      // What changed is not the arithmetic -- it is that reaching it now
      // requires the caller to have said "off" out loud.
      expect(report.status).toBe("ok");
      expect(report.tFinal).toBe(TSPAN[1]);
      expect(report.yFinal[1]!).toBeCloseTo(-701.0788, 3);
      expect(collector.events).toHaveLength(0);
    });

    it("WHY IT EXISTS: a fixed step on an event-bearing model is this repo's normal case", () => {
      // Convergence-order and energy-drift studies must hold h fixed, and
      // every standard projectile model declares a ground-impact event, so
      // this combination is not a caller mistake -- it is the majority of the
      // numerical-methods content here. ADR-016 measured what an
      // unconditional throw costs: 88 tests across 31 files, all legitimate.
      // This is that pattern, now saying what it means.
      const { ctx, model } = setup();
      const stepper = new ClassicalRK4Stepper();
      const report = integrate(
        model,
        ctx,
        new Float64Array([0, 0, 20, 50]),
        [0, 1],
        { stepper: stepper.info.id, h: 1e-2, maxSteps: 5000, events: "off" },
        stepper,
        [],
      );

      expect(report.status).toBe("ok");
      expect(report.tFinal).toBeCloseTo(1, 9);
      expect(report.yFinal[1]!).toBeGreaterThan(0);
    });
  });

  describe('events: "require" -- localizes on a fixed step, via the documented wrapper', () => {
    for (const [name, make] of fixedStepSteppers) {
      it(`${name}: the terminal impact is found, at the ground rather than through it`, () => {
        const collector = new EventCollector();
        const report = run(make(), "require", collector);

        expect(report.status).toBe("ok");
        expect(report.tFinal).toBeLessThan(TSPAN[1]);
        expect(collector.events.length).toBeGreaterThanOrEqual(1);
        expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-6);
      });
    }

    it("the localized time is the physical one, not an artefact of the wrapper", () => {
      const report = run(new ClassicalRK4Stepper(), "require");
      // Cubic Hermite is 3rd order, so this is loose but real.
      expect(report.tFinal).toBeCloseTo(T_IMPACT_EXACT, 3);
    });

    it("is EXACTLY the hand-written workaround, not a second implementation of it", () => {
      // ADR-016 documented `new HermiteDenseOutputStepper(new
      // ClassicalRK4Stepper())` as the workaround needing no core change.
      // "require" must be that and nothing else -- bit-identical state, and
      // the same rhs count, which is what would diverge if the auto-wrap
      // differed in stage reuse or in what it charges the caller.
      const auto = run(new ClassicalRK4Stepper(), "require");
      const manual = run(new HermiteDenseOutputStepper(new ClassicalRK4Stepper()));

      expect(auto.tFinal).toBe(manual.tFinal);
      expect(Array.from(auto.yFinal)).toEqual(Array.from(manual.yFinal));
      expect(auto.nRHS).toBe(manual.nRHS);
      expect(auto.nSteps).toBe(manual.nSteps);
    });

    it("costs the wrapper's documented extra rhs calls, and the cost is visible", () => {
      const off = run(new ClassicalRK4Stepper(), "off");
      const required = run(new ClassicalRK4Stepper(), "require");

      // Not free: ~1 extra model.rhs call per step in steady state. Asserted
      // as a strict inequality per step rather than a pinned total, since the
      // two solves cover different spans once the event truncates one.
      expect(required.nRHS / required.nSteps).toBeGreaterThan(off.nRHS / off.nSteps);
    });
  });

  describe("P0.99's validation criterion, asserted directly", () => {
    it("no stepper returns ok below ground with its declared events silently dropped", () => {
      for (const [, make] of fixedStepSteppers) {
        // Unset: refuses to run at all rather than dropping them.
        expect(() => run(make())).toThrow();

        // "require": runs, and stops AT the ground.
        const localized = run(make(), "require");
        expect(localized.status).toBe("ok");
        expect(localized.yFinal[1]!).toBeGreaterThan(-1e-6);
      }

      // And the one remaining way to finish below ground is the one the
      // caller asked for by name, where the events were not dropped -- they
      // were declined.
      const declined = run(new ClassicalRK4Stepper(), "off");
      expect(declined.yFinal[1]!).toBeLessThan(0);
      expect(declined.status).toBe("ok");
    });
  });
});
