// @vitest-environment jsdom
/**
 * StabilityExplorerRoute mount test (P3.43). Mirrors
 * `convergence-study-route.test.tsx`'s jsdom-mount pattern. Mocks only
 * `@ballista/viz`'s `renderLazyPlotlyPane`/`disposeLazyPlotlyPane` (real
 * Plotly throws outside a browser global scope under jsdom) while
 * preserving every other export (`buildStabilityRegionFigure` etc.) via
 * `importOriginal`, since `StabilityExplorerPage` needs those to actually
 * build the figure.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STABILITY_EXPLORER_METHOD_OPTIONS } from "@ballista/runtime";
import { StabilityExplorerRoute } from "./stability-explorer-route.js";

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

describe("StabilityExplorerRoute (P3.43)", () => {
  it("renders a back link to the main simulator", async () => {
    const root = mount(<StabilityExplorerRoute />);
    await flush();
    const back = root.querySelector(
      '[data-testid="stability-explorer-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("every STABILITY_EXPLORER_METHOD_OPTIONS id has a corresponding <option>", async () => {
    const root = mount(<StabilityExplorerRoute />);
    await flush();
    const select = root.querySelector(
      '[data-testid="stability-explorer-method-select"]',
    ) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    for (const { id } of STABILITY_EXPLORER_METHOD_OPTIONS) {
      expect(optionValues).toContain(id);
    }
  });

  it("renders an eigenvalue readout row once mounted", async () => {
    const root = mount(<StabilityExplorerRoute />);
    await flush();
    expect(root.querySelector('[data-testid="stability-explorer-lambda-0-value"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="stability-explorer-z-0-value"]')).not.toBeNull();
  });

  it("changing the scenario recomputes the sampled trajectory (different traces plotted)", async () => {
    const { renderLazyPlotlyPane } = await import("@ballista/viz");
    const spy = vi.mocked(renderLazyPlotlyPane);

    const root = mount(<StabilityExplorerRoute />);
    await flush();
    const callsBefore = spy.mock.calls.length;
    // The real part (`.x`), not `.im`/`.y`: a quadratic-drag-only scenario's
    // velocity-block Jacobian is symmetric, so its eigenvalues are always
    // real -- `.y` (the imaginary part) is trivially all-zero for both the
    // drag-free default and the shot-put scenario switched to below, which
    // isn't evidence of anything recomputing.
    const traceXBefore = spy.mock.calls.at(-1)![1].traces[1]!.x;

    const select = root.querySelector(
      '[data-testid="stability-explorer-scenario-select"]',
    ) as HTMLSelectElement;
    const otherOption = Array.from(select.options).find((o) => o.value !== select.value)!;
    select.value = otherOption.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
    const traceXAfter = spy.mock.calls.at(-1)![1].traces[1]!.x;
    expect(traceXAfter).not.toEqual(traceXBefore);
  });

  it("changing the method redraws the contour trace for the new order", async () => {
    const { renderLazyPlotlyPane } = await import("@ballista/viz");
    const spy = vi.mocked(renderLazyPlotlyPane);

    const root = mount(<StabilityExplorerRoute />);
    await flush();
    const contourXBefore = spy.mock.calls.at(-1)![1].traces[0]!.x;

    const select = root.querySelector(
      '[data-testid="stability-explorer-method-select"]',
    ) as HTMLSelectElement;
    select.value = "explicit-euler";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const contourXAfter = spy.mock.calls.at(-1)![1].traces[0]!.x;
    expect(contourXAfter).not.toEqual(contourXBefore);
  });
});
