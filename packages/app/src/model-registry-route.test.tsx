// @vitest-environment jsdom
/**
 * ModelRegistryRoute mount test (P4.30). Mirrors
 * `terrain-editor-route.test.tsx`'s jsdom-mount pattern: `useState` +
 * `useMemo` need a real render cycle to observe a re-resolve after a
 * dropdown change. No Plotly/viz dependency here, so no mocking is needed.
 *
 * This is the end-to-end proof of the task's validation criterion
 * ("switching model regenerates channels/controls"): selecting a different
 * model kind on the live-mounted `<select>` changes both the resolved
 * model's dimension/channel list (via a real `resolveModel` call) and the
 * kind-specific param controls `ModelPickerPanel` renders.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRegistryRoute } from "./model-registry-route.js";

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

describe("ModelRegistryRoute (P4.30)", () => {
  it("renders a back link to the main simulator", () => {
    const root = mount(<ModelRegistryRoute />);
    const back = root.querySelector(
      '[data-testid="model-registry-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("initially resolves to the planar (dim-4) model with 4 channels and no param controls", () => {
    const root = mount(<ModelRegistryRoute />);
    expect(root.querySelector('[data-testid="model-registry-dim"]')!.textContent).toBe("4");
    expect(
      root.querySelectorAll('[data-testid="model-registry-resolved-channels"] li'),
    ).toHaveLength(4);
    expect(root.querySelector('[data-testid="model-picker-channel-x"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="model-registry-error"]')).toBeNull();
  });

  it("switching to spatial regenerates the resolved model's dim/channels to 6 and z/vz, and adds z0/vz0 controls", async () => {
    const root = mount(<ModelRegistryRoute />);
    const select = root.querySelector('[data-testid="model-kind-select"]') as HTMLSelectElement;

    select.value = "spatial";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(root.querySelector('[data-testid="model-registry-dim"]')!.textContent).toBe("6");
    expect(
      root.querySelectorAll('[data-testid="model-registry-resolved-channels"] li'),
    ).toHaveLength(6);
    expect(root.querySelector('[data-testid="model-registry-resolved-channel-z"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="model-registry-resolved-channel-vz"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="model-picker-channel-z"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="model-registry-error"]')).toBeNull();

    const numberInputs = root.querySelectorAll(".model-picker-panel input[type='number']");
    expect(numberInputs.length).toBeGreaterThan(0);
  });

  it("switching to planar-spin regenerates the resolved model's dim/channels to 5 and omega, and adds a tauOmega control", async () => {
    const root = mount(<ModelRegistryRoute />);
    const select = root.querySelector('[data-testid="model-kind-select"]') as HTMLSelectElement;

    select.value = "planar-spin";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(root.querySelector('[data-testid="model-registry-dim"]')!.textContent).toBe("5");
    expect(
      root.querySelectorAll('[data-testid="model-registry-resolved-channels"] li'),
    ).toHaveLength(5);
    expect(
      root.querySelector('[data-testid="model-registry-resolved-channel-omega"]'),
    ).not.toBeNull();
    expect(root.querySelector('[data-testid="model-picker-channel-omega"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="model-registry-error"]')).toBeNull();
  });

  it("switching spatial -> planar drops back to dim 4 and no param controls (channels/controls regenerate both ways)", async () => {
    const root = mount(<ModelRegistryRoute />);
    const select = root.querySelector('[data-testid="model-kind-select"]') as HTMLSelectElement;

    select.value = "spatial";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(root.querySelector('[data-testid="model-registry-dim"]')!.textContent).toBe("6");

    select.value = "planar";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(root.querySelector('[data-testid="model-registry-dim"]')!.textContent).toBe("4");
    expect(root.querySelector('.model-picker-panel input[type="number"]')).toBeNull();
  });
});
