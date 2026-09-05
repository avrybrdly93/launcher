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
    expect(renderLazyPlotlyPane).toHaveBeenCalledWith(el, SPEC, {
      shouldMount: expect.any(Function),
    });
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
    expect(renderLazyPlotlyPane).toHaveBeenLastCalledWith(expect.anything(), nextSpec, {
      shouldMount: expect.any(Function),
    });
  });

  it("disposes on unmount", async () => {
    const root = mount(SPEC);
    await flush();

    render(null, root);
    await flush();

    expect(disposeLazyPlotlyPane).toHaveBeenCalledTimes(1);
  });

  /**
   * P0.118. The regression these guard is a route change landing while the
   * Plotly dynamic import is still in flight: the mount then completes against
   * a container this effect has already abandoned, and a `responsive: true`
   * plot on a detached node keeps handlers alive with nothing left to purge
   * them. The view cannot cancel the import, so what it owes
   * `renderLazyPlotlyPane` is an honest answer to "are you still wanted?" at
   * the moment the import lands -- which is `shouldMount`.
   */
  describe("cancellation on teardown", () => {
    it("reports the mount as still wanted while the effect is live", async () => {
      mount(SPEC);
      await flush();

      const shouldMount = renderLazyPlotlyPane.mock.calls.at(-1)![2].shouldMount as () => boolean;
      expect(shouldMount()).toBe(true);
    });

    it("reports the mount as abandoned once the component unmounts", async () => {
      const root = mount(SPEC);
      await flush();
      const shouldMount = renderLazyPlotlyPane.mock.calls.at(-1)![2].shouldMount as () => boolean;

      render(null, root);
      await flush();

      expect(shouldMount()).toBe(false);
    });

    it("abandons only the superseded mount when the spec changes, not the new one", async () => {
      const root = mount(SPEC);
      await flush();
      const first = renderLazyPlotlyPane.mock.calls.at(-1)![2].shouldMount as () => boolean;

      render(<LazyPlotlyView spec={{ ...SPEC, xAxis: { title: "t" } }} />, root);
      await flush();
      const second = renderLazyPlotlyPane.mock.calls.at(-1)![2].shouldMount as () => boolean;

      // Each effect run latches its own flag; a stale render must not be able
      // to cancel the live one, which is what a single shared flag would do.
      expect(first()).toBe(false);
      expect(second()).toBe(true);
    });
  });
});
