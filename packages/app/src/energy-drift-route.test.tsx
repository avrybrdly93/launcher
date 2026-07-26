// @vitest-environment jsdom
/**
 * EnergyDriftRoute mount test (P3.44 shell). Mirrors
 * `solver-lab-route.test.tsx`'s jsdom-mount pattern: `useMemo` needs a real
 * render cycle. Mocks only `@ballista/viz`'s
 * `renderLazyPlotlyPane`/`disposeLazyPlotlyPane` (real Plotly throws outside
 * a browser global scope under jsdom, same reasoning as
 * `lazy-plotly-view.test.tsx`/`convergence-study-route.test.tsx`) while
 * preserving every other export (`buildEnergyDriftFigure` etc.) via
 * `importOriginal`, since `EnergyDriftPage` needs those to actually build
 * the figure.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnergyDriftRoute } from "./energy-drift-route.js";

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

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

const METHOD_IDS = ["explicit-euler", "classical-rk4", "semi-implicit-euler", "velocity-verlet"];

describe("EnergyDriftRoute (P3.44)", () => {
  it("renders a row with a non-empty final-drift readout for every flagship method", () => {
    const root = mount(<EnergyDriftRoute />);

    for (const id of METHOD_IDS) {
      const errorEl = root.querySelector(`[data-testid="energy-drift-method-${id}-final-error"]`);
      expect(errorEl).not.toBeNull();
      expect(errorEl!.textContent).not.toBe("");
    }
  });

  it("renders a back link to the main simulator", () => {
    const root = mount(<EnergyDriftRoute />);
    const back = root.querySelector('[data-testid="energy-drift-back-link"]') as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("mounts a Plotly pane container for the four traces", () => {
    const root = mount(<EnergyDriftRoute />);
    expect(root.querySelector('[data-testid="lazy-plotly-view"]')).not.toBeNull();
  });
});
