// @vitest-environment jsdom
/**
 * DensityAltitudeRoute mount test (P4.29). Mirrors
 * `neglected-effects-route.test.tsx`'s jsdom-mount pattern: `useMemo` needs
 * a real render cycle. No Plotly/viz dependency here, so no mocking is
 * needed.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { DensityAltitudeRoute } from "./density-altitude-route.js";

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

describe("DensityAltitudeRoute (P4.29)", () => {
  it("renders a non-empty range-increase readout", () => {
    const root = mount(<DensityAltitudeRoute />);
    const increaseEl = root.querySelector('[data-testid="density-altitude-increase"]');
    expect(increaseEl).not.toBeNull();
    expect(increaseEl!.textContent).toMatch(/^[+-]\d+\.\d m \([+-]\d+\.\d%\)$/);
  });

  it("renders a back link to the main simulator", () => {
    const root = mount(<DensityAltitudeRoute />);
    const back = root.querySelector(
      '[data-testid="density-altitude-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });
});
