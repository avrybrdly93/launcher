// @vitest-environment jsdom
/**
 * NeglectedEffectsRoute mount test (P4.20). Mirrors
 * `energy-drift-route.test.tsx`'s jsdom-mount pattern: `useMemo` needs a
 * real render cycle. No Plotly/viz dependency here, so no mocking is
 * needed.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { NeglectedEffectsRoute } from "./neglected-effects-route.js";

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

describe("NeglectedEffectsRoute (P4.20)", () => {
  it("renders a non-empty buoyancy-to-weight ratio readout", () => {
    const root = mount(<NeglectedEffectsRoute />);
    const ratioEl = root.querySelector('[data-testid="neglected-effects-ratio"]');
    expect(ratioEl).not.toBeNull();
    expect(ratioEl!.textContent).toMatch(/^\d+\.\d%$/);
  });

  it("renders a back link to the main simulator", () => {
    const root = mount(<NeglectedEffectsRoute />);
    const back = root.querySelector(
      '[data-testid="neglected-effects-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });
});
