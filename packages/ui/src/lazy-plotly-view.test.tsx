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

// Spread the real module rather than replacing it (the shape
// `basin-panel.test.tsx` and `convergence-trace-panel.test.tsx` already use):
// since P0.124 the view also calls `plotlyFigureSpecsEqual`, and that IS part of
// what is under test here -- faking it would test a fake.
vi.mock("@ballista/viz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ballista/viz")>()),
  renderLazyPlotlyPane,
  disposeLazyPlotlyPane,
}));

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
   * P0.124. The defect: the effect was keyed on the spec's object identity, and
   * every call site built a fresh spec per render, so any parent re-render
   * purged the pane and called `newPlot` again. These assert CALL COUNTS across
   * a re-render rather than inspecting the spec, which is what the row's
   * validation criterion asks for -- an implementation that memoises the wrong
   * thing would still look right under inspection.
   */
  describe("re-render with an unchanged figure", () => {
    it("does not remount when handed an equal spec as a fresh object", async () => {
      const root = mount(SPEC);
      await flush();
      expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);

      // A structurally identical spec with no shared identity -- what every
      // call site produces on every render.
      render(
        <LazyPlotlyView spec={{ ...SPEC, traces: [{ ...SPEC.traces[0]!, x: [1, 2] }] }} />,
        root,
      );
      await flush();

      expect(disposeLazyPlotlyPane).not.toHaveBeenCalled();
      expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);
    });

    it("does not remount across many re-renders with equal specs", async () => {
      const root = mount(SPEC);
      await flush();

      for (let pass = 0; pass < 5; pass += 1) {
        render(
          <LazyPlotlyView spec={{ ...SPEC, traces: [{ name: "a", x: [1, 2], y: [3, 4] }] }} />,
          root,
        );
        await flush();
      }

      // Five was one purge + newPlot each before this fix. A test that only
      // checked one re-render could pass on an implementation that alternated.
      expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);
      expect(disposeLazyPlotlyPane).not.toHaveBeenCalled();
    });

    it("still remounts on the render AFTER an equal one, when the figure does change", async () => {
      const root = mount(SPEC);
      await flush();
      render(<LazyPlotlyView spec={{ ...SPEC }} />, root);
      await flush();
      expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);

      const changed = { ...SPEC, traces: [{ name: "a", x: [1, 2], y: [3, 5] }] };
      render(<LazyPlotlyView spec={changed} />, root);
      await flush();

      // The stale-plot failure mode: having skipped one update, the view must
      // not have lost track of what is mounted.
      expect(disposeLazyPlotlyPane).toHaveBeenCalledTimes(1);
      expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(2);
      expect(renderLazyPlotlyPane).toHaveBeenLastCalledWith(expect.anything(), changed, {
        shouldMount: expect.any(Function),
      });
    });

    it("mounts the figure the caller asked for after a skipped update", async () => {
      // A held spec that is EQUAL to the incoming one is interchangeable with
      // it, so passing the held object on is correct -- but only if the held
      // object really is the equal one and not an earlier, different figure.
      const root = mount(SPEC);
      await flush();
      render(<LazyPlotlyView spec={{ ...SPEC, yAxis: { title: "y" } }} />, root);
      await flush();

      expect(renderLazyPlotlyPane).toHaveBeenCalledTimes(1);
      expect(renderLazyPlotlyPane).toHaveBeenLastCalledWith(expect.anything(), SPEC, {
        shouldMount: expect.any(Function),
      });
    });
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
