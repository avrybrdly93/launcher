import {
  KNOWN_FORCE_IDS,
  resolveModel,
  resolveSolverConfig,
  resolveStepper,
} from "./scenario-resolver.js";
import { SCENARIO_LIBRARY } from "@ballista/engine";
import { integrate } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";

/**
 * The runnable half of P4.36's "CI validates all specs" criterion.
 * `scenario-library.test.ts` (in `engine`) proves every spec *parses*; this
 * proves every spec *resolves and integrates*, which is a strictly stronger
 * and separately breakable property -- a spec naming a force id or stepper
 * id outside the runtime registries parses perfectly and then throws at
 * `resolveForce`/`resolveStepper`. That gap is exactly why the library
 * excludes Coriolis (see `scenario-library.ts`'s doc comment), and this
 * file is what would catch a future entry that reintroduces it.
 *
 * It lives in `runtime` rather than `engine` because the resolvers do:
 * `engine` is downstream of nothing and cannot import them.
 */
describe("SCENARIO_LIBRARY resolvability", () => {
  it("every spec's force ids are registered in the runtime resolver", () => {
    for (const entry of SCENARIO_LIBRARY) {
      for (const forceId of entry.spec.model.forceIds) {
        expect(KNOWN_FORCE_IDS, `${entry.id} -> ${forceId}`).toContain(forceId);
      }
    }
  });

  it("every spec resolves to a live model, context and correctly sized initial state", () => {
    const expectedDim = { planar: 4, "planar-spin": 5, spatial: 6 } as const;

    for (const entry of SCENARIO_LIBRARY) {
      const resolved = resolveModel(entry.spec);
      const kind = entry.spec.model.kind ?? "planar";

      expect(resolved.y0.length, entry.id).toBe(expectedDim[kind]);
      expect(resolved.forces.length, entry.id).toBe(entry.spec.model.forceIds.length);
      expect(Number.isFinite(resolved.y0[0]), entry.id).toBe(true);
    }
  });

  it("every spec's stepper id resolves to a live stepper", () => {
    for (const entry of SCENARIO_LIBRARY) {
      expect(() => resolveStepper(entry.spec.solver.stepper), entry.id).not.toThrow();
    }
  });

  it("every spec integrates a short span without erroring or producing non-finite state", () => {
    // A short span only: this test asserts the specs are *runnable*, not
    // that they land in any particular place -- range values belong to the
    // golden-trajectory suite, not here. The dust grain is stiff enough
    // that a long explicit run would legitimately diverge, which would make
    // this a test of solver stability rather than of spec validity.
    const T_SPAN: readonly [number, number] = [0, 0.05];

    for (const entry of SCENARIO_LIBRARY) {
      const { model, ctx, y0 } = resolveModel(entry.spec);
      const stepper = resolveStepper(entry.spec.solver.stepper);
      const cfg = resolveSolverConfig(entry.spec);

      const report = integrate(model, ctx, y0, T_SPAN, cfg, stepper);

      expect(report.status, `${entry.id}: ${report.status}`).toBe("ok");
      for (const [i, value] of Array.from(report.yFinal).entries()) {
        expect(Number.isFinite(value), `${entry.id} yFinal[${i}]`).toBe(true);
      }
    }
  });
});
