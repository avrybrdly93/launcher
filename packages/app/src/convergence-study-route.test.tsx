// @vitest-environment jsdom
/**
 * ConvergenceStudyRoute mount test (P3.42). Mirrors `solver-lab-route.test.tsx`'s
 * jsdom-mount pattern (hooks need a real render cycle). Mocks only
 * `@ballista/viz`'s `renderLazyPlotlyPane`/`disposeLazyPlotlyPane` (real
 * Plotly throws outside a browser global scope under jsdom, same reasoning
 * as `lazy-plotly-view.test.tsx`) while preserving every other export
 * (`buildConvergenceFigure` etc.) via `importOriginal`, since
 * `ConvergenceStudyPage` needs those to actually build the figure.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONVERGENCE_STUDY_METHOD_OPTIONS } from "@ballista/runtime";
import { ConvergenceStudyRoute } from "./convergence-study-route.js";

vi.mock("@ballista/viz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ballista/viz")>();
  return {
    ...actual,
    renderLazyPlotlyPane: vi.fn().mockResolvedValue(undefined),
    disposeLazyPlotlyPane: vi.fn().mockResolvedValue(undefined),
  };
});

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

describe("ConvergenceStudyRoute (P3.42)", () => {
  it("renders a slope readout for every default-selected method", async () => {
    const root = mount(<ConvergenceStudyRoute />);
    await flush();

    for (const id of ["explicit-euler", "classical-rk4", "dopri5"]) {
      const cell = root.querySelector(`[data-testid="convergence-study-slope-${id}-value"]`);
      expect(cell).not.toBeNull();
      expect(cell!.textContent).not.toBe("");
    }
  });

  it("renders a back link to the main simulator", async () => {
    const root = mount(<ConvergenceStudyRoute />);
    await flush();
    const back = root.querySelector(
      '[data-testid="convergence-study-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("toggling a method checkbox adds/removes its slope row", async () => {
    const root = mount(<ConvergenceStudyRoute />);
    await flush();

    const bogackiCheckbox = root.querySelector(
      '[data-testid="convergence-study-method-bogacki-shampine-32"]',
    ) as HTMLInputElement;
    expect(bogackiCheckbox.checked).toBe(false);
    expect(
      root.querySelector('[data-testid="convergence-study-slope-bogacki-shampine-32"]'),
    ).toBeNull();

    bogackiCheckbox.checked = true;
    bogackiCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(
      root.querySelector('[data-testid="convergence-study-slope-bogacki-shampine-32"]'),
    ).not.toBeNull();
  });

  it("changing the scenario recomputes the study for the new scenario", async () => {
    const { renderLazyPlotlyPane } = await import("@ballista/viz");
    const spy = vi.mocked(renderLazyPlotlyPane);

    const root = mount(<ConvergenceStudyRoute />);
    await flush();
    const callsBefore = spy.mock.calls.length;
    const traceYBefore = spy.mock.calls.at(-1)![1].traces[0]!.y;

    const select = root.querySelector(
      '[data-testid="convergence-study-scenario-select"]',
    ) as HTMLSelectElement;
    const otherOption = Array.from(select.options).find((o) => o.value !== select.value)!;
    select.value = otherOption.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    // Different scenarios have different flight dynamics/duration, so the
    // errors measured at the same default h-ladder are expected to differ
    // -- proof the study actually recomputed rather than staying stale
    // (a fitted-slope readout rounded to 2 decimals can coincidentally
    // match across scenarios, which made this assertion flaky when it
    // compared the displayed slope text instead).
    expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
    const traceYAfter = spy.mock.calls.at(-1)![1].traces[0]!.y;
    expect(traceYAfter).not.toEqual(traceYBefore);
  });

  it("every CONVERGENCE_STUDY_METHOD_OPTIONS id has a corresponding checkbox", async () => {
    const root = mount(<ConvergenceStudyRoute />);
    await flush();
    for (const { id } of CONVERGENCE_STUDY_METHOD_OPTIONS) {
      expect(root.querySelector(`[data-testid="convergence-study-method-${id}"]`)).not.toBeNull();
    }
  });
});
