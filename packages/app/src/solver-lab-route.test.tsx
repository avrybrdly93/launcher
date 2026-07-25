// @vitest-environment jsdom
/**
 * SolverLabRoute mount test (P3.41). Mirrors `accessibility.test.tsx`'s
 * jsdom-mount pattern: hooks (`useState`/`useMemo`) need a real render
 * cycle, unlike the vnode-inspection style used for hook-free components
 * elsewhere in this repo.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { SOLVER_LAB_COLUMN_STEPPERS } from "@ballista/runtime";
import { SolverLabRoute } from "./solver-lab-route.js";

const TABLE_TENNIS = PRESET_SCENARIOS.find((s) => s.projectile.id === "table-tennis-ball")!;

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

describe("SolverLabRoute (P3.41)", () => {
  it("renders a column per method with a non-empty error readout", () => {
    const root = mount(<SolverLabRoute scenario={TABLE_TENNIS} />);

    for (const { id } of SOLVER_LAB_COLUMN_STEPPERS) {
      const errorEl = root.querySelector(`[data-testid="solver-lab-column-${id}-error"]`);
      expect(errorEl).not.toBeNull();
      expect(errorEl!.textContent).not.toBe("");
    }
  });

  it("renders a back link to the main simulator", () => {
    const root = mount(<SolverLabRoute scenario={TABLE_TENNIS} />);
    const back = root.querySelector('[data-testid="solver-lab-back-link"]') as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("changing the h input re-runs the comparison at the new step size", async () => {
    const root = mount(<SolverLabRoute scenario={TABLE_TENNIS} />);
    const input = root.querySelector('[data-testid="solver-lab-h-input"]') as HTMLInputElement;
    const eulerStepsBefore = root.querySelector(
      '[data-testid="solver-lab-column-explicit-euler-steps"]',
    )!.textContent;

    input.value = "0.2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Preact batches state updates onto a microtask (`options.debounceRendering`);
    // flush it before reading the re-rendered DOM.
    await Promise.resolve();
    await Promise.resolve();

    const eulerStepsAfter = root.querySelector(
      '[data-testid="solver-lab-column-explicit-euler-steps"]',
    )!.textContent;
    expect(eulerStepsAfter).not.toBe(eulerStepsBefore);
  });
});
