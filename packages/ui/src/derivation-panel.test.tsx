// @vitest-environment jsdom
/**
 * Mocks `@ballista/viz`'s `renderLazyKatexPane`/`disposeLazyKatexPane`
 * directly, mirroring `lazy-plotly-view.test.tsx`'s reasoning exactly: those
 * two functions are `DerivationPanel`'s actual contract, and this is the
 * boundary `vi.mock` can actually intercept.
 */
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderLazyKatexPane = vi.fn().mockResolvedValue(undefined);
const disposeLazyKatexPane = vi.fn();

vi.mock("@ballista/viz", () => ({ renderLazyKatexPane, disposeLazyKatexPane }));

const { DerivationPanel } = await import("./derivation-panel.js");

let container: HTMLDivElement | undefined;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(blocks: Parameters<typeof DerivationPanel>[0]["blocks"]): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(<DerivationPanel title="Derivation" blocks={blocks} />, container);
  return container;
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
  renderLazyKatexPane.mockClear();
  disposeLazyKatexPane.mockClear();
});

const BLOCKS = [
  { kind: "heading" as const, level: 1, inlines: [{ kind: "text" as const, text: "Title" }] },
];

describe("DerivationPanel (P3.45)", () => {
  it("never renders the KaTeX pane while the <details> stays closed", async () => {
    mount(BLOCKS);
    await flush();
    expect(renderLazyKatexPane).not.toHaveBeenCalled();
  });

  it("renders the KaTeX pane into the content div only once the reader opens the panel", async () => {
    const root = mount(BLOCKS);
    const details = root.querySelector('[data-testid="derivation-panel"]') as HTMLDetailsElement;
    const content = root.querySelector('[data-testid="derivation-panel-content"]');

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await flush();

    expect(renderLazyKatexPane).toHaveBeenCalledTimes(1);
    expect(renderLazyKatexPane).toHaveBeenCalledWith(content, BLOCKS);
  });

  it("disposes the pane when the reader closes the panel again", async () => {
    const root = mount(BLOCKS);
    const details = root.querySelector('[data-testid="derivation-panel"]') as HTMLDetailsElement;

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await flush();
    expect(renderLazyKatexPane).toHaveBeenCalledTimes(1);

    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    await flush();
    expect(disposeLazyKatexPane).toHaveBeenCalledTimes(1);
  });

  it("shows the given title in the summary", () => {
    const root = mount(BLOCKS);
    const summary = root.querySelector('[data-testid="derivation-panel-summary"]');
    expect(summary!.textContent).toBe("Derivation");
  });
});
