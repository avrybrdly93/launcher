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

/**
 * How long to wait for a lazily-imported derivation panel to render before
 * giving up (P0.106). Generous on purpose: it is a deadline for a hang, not a
 * budget for a machine — the test normally satisfies it in a few milliseconds
 * and only approaches it if the dynamic import never resolves at all.
 */
const DERIVATION_RENDER_DEADLINE_MS = 20_000;

/**
 * Wait until a derivation panel has rendered *something*, then hand the
 * element back for the caller to assert on.
 *
 * This replaces a fixed spin of five macrotask turns, which was the mechanism
 * behind P0.106's fourth sighting: under the parallel suite the real dynamic
 * import of KaTeX plus its module transform needs more turns than any
 * constant, the panel is still empty when the turns run out, and the caller
 * asserts against `''`. It failed on CI and passed 3/3 standalone in the same
 * container minutes later.
 *
 * Deliberately weaker than what the caller asserts: this waits only for the
 * panel to be non-empty, so the assertions about *what* rendered keep their
 * discriminating power. Waiting on the assertion's own condition would make it
 * vacuous.
 */
async function waitForRenderedDerivation(details: HTMLDetailsElement): Promise<Element> {
  const deadline = Date.now() + DERIVATION_RENDER_DEADLINE_MS;
  for (;;) {
    const content = details.querySelector('[data-testid="derivation-panel-content"]');
    if (content && content.textContent !== "") return content;
    if (Date.now() >= deadline) {
      throw new Error(
        `derivation panel was still empty after ${DERIVATION_RENDER_DEADLINE_MS} ms; ` +
          "the lazy KaTeX import never resolved (this is a hang, not a slow machine)",
      );
    }
    // A macrotask, so the import's promise chain and the module transform both
    // get real turns to make progress between polls.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

  it("opening a column's derivation panel renders real KaTeX-rendered content from the actual derivation.md source (P3.45)", async () => {
    const root = mount(<SolverLabRoute scenario={TABLE_TENNIS} />);
    const details = root.querySelectorAll('[data-testid="derivation-panel"]');
    // Every SOLVER_LAB_COLUMN_STEPPERS entry has a known derivation.md
    // (explicit-euler, classical-rk4, dopri5), so every column gets a panel.
    expect(details).toHaveLength(SOLVER_LAB_COLUMN_STEPPERS.length);

    const eulerDetails = details[0] as HTMLDetailsElement;
    eulerDetails.open = true;
    eulerDetails.dispatchEvent(new Event("toggle"));
    // The lazy KaTeX module load is a real dynamic import (unmocked here,
    // unlike the Plotly panes, since KaTeX does pure DOM/string rendering
    // and needs none of jsdom's unimplemented canvas/URL APIs) -- wait for its
    // promise chain and the module transform to actually settle, rather than
    // for a fixed number of turns. See waitForRenderedDerivation (P0.106).
    const content = await waitForRenderedDerivation(eulerDetails);
    // The real explicit-euler-stepper.derivation.md source, KaTeX-rendered:
    // its own title heading text and a real KaTeX-produced class.
    expect(content.textContent).toContain("Explicit (Forward) Euler");
    expect(content.querySelector(".katex")).not.toBeNull();
  });
});
