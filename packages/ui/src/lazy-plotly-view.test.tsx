// @vitest-environment jsdom
/**
 * Mocks `@ballista/viz`'s `renderLazyPlotlyPane`/`disposeLazyPlotlyPane`
 * directly (rather than the underlying `plotly.js-dist-min` module the way
 * `lazy-plotly-pane.runtime.test.ts` does): those two functions -- not
 * Plotly's own internals -- are `LazyPlotlyView`'s actual contract, and a
 * dynamic `import("plotly.js-dist-min")` reached through the `@ballista/viz`
 * workspace package doesn't resolve to the same module id `vi.mock` targets
 * from this package, so mocking at the viz-package boundary is both the
 * right unit and the one that's actually interceptable here.
 */
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderLazyPlotlyPane = vi.fn().mockResolvedValue(undefined);
const disposeLazyPlotlyPane = vi.fn().mockResolvedValue(undefined);

vi.mock("@ballista/viz", () => ({ renderLazyPlotlyPane, disposeLazyPlotlyPane }));

const { LazyPlotlyView } = await import("./lazy-plotly-view.js");

let container: HTMLDivElement | undefined;

/** Flushes the async `renderLazyPlotlyPane`/`disposeLazyPlotlyPane` promise chain the effect kicks off. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(spec: Parameters<typeof LazyPlotlyView>[0]["spec"]): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(<LazyPlotlyView spec={spec} />, container);
  return container;
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
  renderLazyPlotlyPane.mockClear();
  disposeLazyPlotlyPane.mockClear();
});

const SPEC = {
  traces: [{ name: "a", x: [1, 2], y: [3, 4] }],
  xAxis: { title: "x" },
  yAxis: { title: "y" },
};

describe("LazyPlotlyView", () => {
  it("mounts a container div and renders the given figure spec into it", async () => {
    const root = mount(SPEC);
    await flush();

    const el = root.querySelector('[data-testid="lazy-plotly-view"]');
    expect(el).not.toBeNull();
    expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);
    expect(renderLazyPlotlyPane).toHaveBeenCalledWith(el, SPEC);
  });

  it("disposes the previous pane and re-renders when the spec changes", async () => {
    const root = mount(SPEC);
    await flush();
    expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);

    const nextSpec = { ...SPEC, traces: [{ name: "b", x: [5, 6], y: [7, 8] }] };
    render(<LazyPlotlyView spec={nextSpec} />, root);
    await flush();

    expect(disposeLazyPlotlyPane).toHaveBeenCalledTimes(1);
    expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(2);
    expect(renderLazyPlotlyPane).toHaveBeenLastCalledWith(expect.anything(), nextSpec);
  });

  it("disposes on unmount", async () => {
    const root = mount(SPEC);
    await flush();

    render(null, root);
    await flush();

    expect(disposeLazyPlotlyPane).toHaveBeenCalledTimes(1);
  });
});
