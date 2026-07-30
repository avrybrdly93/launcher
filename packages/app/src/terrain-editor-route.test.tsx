// @vitest-environment jsdom
/**
 * TerrainEditorRoute mount test (P4.14). Mirrors
 * `stability-explorer-route.test.tsx`'s jsdom-mount pattern, minus the
 * `@ballista/viz` mock those routes need for Plotly -- this route renders
 * a plain SVG (`TerrainEditorPage`), no Plotly involved.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { TerrainEditorRoute } from "./terrain-editor-route.js";

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

describe("TerrainEditorRoute (P4.14)", () => {
  it("renders a back link to the main simulator", () => {
    const root = mount(<TerrainEditorRoute />);
    const back = root.querySelector(
      '[data-testid="terrain-editor-back-link"]',
    ) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("renders an initial impact readout for the default terrain", () => {
    const root = mount(<TerrainEditorRoute />);
    const readout = root.querySelector('[data-testid="terrain-editor-impact-readout"]');
    expect(readout!.textContent).toMatch(/^Impact at/);
  });

  it("edited terrain re-solves live: dragging a point's y via its numeric input changes the impact readout", async () => {
    const root = mount(<TerrainEditorRoute />);
    const readoutBefore = root.querySelector(
      '[data-testid="terrain-editor-impact-readout"]',
    )!.textContent;

    const yInput = root.querySelector(
      '[data-testid="terrain-editor-point-1-y"]',
    ) as HTMLInputElement;
    yInput.value = "40";
    yInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const readoutAfter = root.querySelector(
      '[data-testid="terrain-editor-impact-readout"]',
    )!.textContent;
    expect(readoutAfter).not.toBe(readoutBefore);
  });

  it("serialization round trip: Export then Import reproduces the same impact readout", async () => {
    const root = mount(<TerrainEditorRoute />);

    (
      root.querySelector('[data-testid="terrain-editor-export-button"]') as HTMLButtonElement
    ).click();
    await flush();
    const exported = (
      root.querySelector('[data-testid="terrain-editor-export-output"]') as HTMLTextAreaElement
    ).value;
    const readoutBeforeEdit = root.querySelector(
      '[data-testid="terrain-editor-impact-readout"]',
    )!.textContent;

    // Perturb the terrain, then import the originally-exported JSON back.
    const yInput = root.querySelector(
      '[data-testid="terrain-editor-point-1-y"]',
    ) as HTMLInputElement;
    yInput.value = "40";
    yInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(
      root.querySelector('[data-testid="terrain-editor-impact-readout"]')!.textContent,
    ).not.toBe(readoutBeforeEdit);

    const importInput = root.querySelector(
      '[data-testid="terrain-editor-import-input"]',
    ) as HTMLTextAreaElement;
    importInput.value = exported;
    importInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    (
      root.querySelector('[data-testid="terrain-editor-import-button"]') as HTMLButtonElement
    ).click();
    await flush();

    expect(root.querySelector('[data-testid="terrain-editor-impact-readout"]')!.textContent).toBe(
      readoutBeforeEdit,
    );
  });

  it("Import surfaces an error and does not crash the route on a too-short control-point list", async () => {
    const root = mount(<TerrainEditorRoute />);
    const importInput = root.querySelector(
      '[data-testid="terrain-editor-import-input"]',
    ) as HTMLTextAreaElement;
    importInput.value = JSON.stringify([{ x: 0, y: 0 }]);
    importInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    (
      root.querySelector('[data-testid="terrain-editor-import-button"]') as HTMLButtonElement
    ).click();
    await flush();

    expect(root.querySelector('[data-testid="terrain-editor-import-error"]')).not.toBeNull();
    // The route itself is still alive and showing a valid readout, not crashed.
    expect(root.querySelector('[data-testid="terrain-editor-impact-readout"]')).not.toBeNull();
  });
});
