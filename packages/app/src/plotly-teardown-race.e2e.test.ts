import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_TARGETS, tryLaunch } from "./e2e-browser.js";
import { PLOTLY_PANE_TEST_HANDLE } from "./plotly-teardown-race.browser-fixture.js";

/**
 * Deterministic reproduction of P0.118 -- the `Cannot read properties of
 * undefined (reading '_redrawFromAutoMarginCount')` page error -- and the
 * regression pin for the fix that closes it.
 *
 * **Why this suite exists, and why the tests beside `lazy-plotly-pane.ts` were
 * not enough.** Those tests mock Plotly, so they can assert that the module
 * *consults* its guard and *orders* its operations, but they can never observe
 * the error the guard exists to prevent -- the read of `_redrawFromAutoMargin
 * Count` happens inside Plotly's own redraw. Everything else the task tried was
 * a rate: the 79th run took twenty full-suite runs before the fix and twenty
 * after, and both came back clean, so the protocol did not discriminate. The
 * task's own handover asked for "a deterministic trigger for the abandoned-mount
 * interleaving the fix guards" instead of another undiscriminating twenty. This
 * is that trigger.
 *
 * **The mechanism, as measured here rather than argued.** `newPlot` schedules
 * auto-margin work that runs after it returns to the event loop. A `purge` that
 * lands in that window deletes `gd._fullLayout`, and the scheduled redraw then
 * dereferences it. The first case below does exactly that with raw Plotly and
 * no application code in the picture, and it fails the same way every time --
 * so the error signature is pinned to this interleaving specifically, not to
 * load, contention, or a browser quirk.
 *
 * **What gives the remaining cases teeth.** Both were checked by mutation
 * against `lazy-plotly-pane.ts`, the file restored from a backup afterwards:
 * replacing `enqueuePaneOperation` with a bare `operation()` call makes the
 * queue case fail with the exact error string case 1 pins, and dropping the
 * `shouldMount` guard makes the abandoned-mount case mount into a container the
 * caller has already released.
 *
 * **A third mutation is NOT caught here, and saying so is the point.** Moving
 * the `shouldMount` check to *before* the import -- the interleaving the unit
 * tests beside the module do catch -- leaves every case below green, because
 * `enqueuePaneOperation` defers the operation by a microtask and the caller's
 * flag is therefore already latched whichever side of the import the check sits
 * on. Controlling when the import resolves is what discriminates there, and
 * that needs the mocked module. This suite is the complement to those tests,
 * not a replacement for them.
 *
 * **This suite drives no server and opens no websocket.** It sets a blank
 * document and injects two script tags. That is deliberate: it keeps the suite
 * away from the Vite dev client entirely, and so away from P0.125, which
 * reddens `app-routes.e2e.test.ts` from inside playwright-core's Firefox
 * websocket transport without any test failing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The shipped Plotly dist file, resolved from the package that actually depends
 * on it. `@ballista/app` does not depend on `plotly.js-dist-min` directly and
 * should not start: under pnpm's default layout it is therefore absent from
 * this package's own `node_modules`, and a hand-written path into the store
 * would encode a layout that differs between this sandbox and CI. Resolving
 * from `@ballista/viz`'s directory asks the package manager instead, and it is
 * a file read rather than an import, so no dependency edge is created.
 */
function resolvePlotlyDistPath(): string {
  const vizRequire = createRequire(path.join(here, "..", "..", "viz", "src", "index.ts"));
  return vizRequire.resolve("plotly.js-dist-min/plotly.min.js");
}

/**
 * Bundles the browser fixture with `plotly.js-dist-min` aliased to the shim, so
 * the page runs the real pane module against the real Plotly it was handed.
 *
 * `inlineDynamicImports` collapses the module's `import()` into the same chunk.
 * That does **not** flatten the await this suite is about: an inlined dynamic
 * import still resolves through a promise, so `renderLazyPlotlyPane` still
 * reaches Plotly one turn of the event loop after it is called, which is the
 * window every case below aims at. It only means the test does not need a
 * server to fetch a second chunk from.
 */
async function buildBrowserFixture(): Promise<string> {
  const result = await build({
    root: here,
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: {
        "plotly.js-dist-min": path.join(here, "plotly-teardown-race.plotly-shim.ts"),
      },
    },
    build: {
      write: false,
      minify: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
      lib: {
        entry: path.join(here, "plotly-teardown-race.browser-fixture.ts"),
        formats: ["es"],
        fileName: () => "fixture.js",
      },
    },
  });

  const single = Array.isArray(result) ? result[0]! : result;
  const output = (single as unknown as { output: readonly BuiltChunk[] }).output;
  const entry = output.find((chunk) => chunk.type === "chunk" && chunk.isEntry === true);
  if (!entry?.code) throw new Error("vite produced no entry chunk for the browser fixture");
  return entry.code;
}

interface BuiltChunk {
  readonly type: string;
  readonly isEntry?: boolean;
  readonly code?: string;
}

/** The exact error P0.118 was filed on. Matched as a substring so a stack or a browser-specific prefix does not matter. */
const REDRAW_ERROR = "_redrawFromAutoMarginCount";

/** A figure shaped like the ones the exploratory panes actually plot -- titled and axis-labelled, because it is the auto-margin pass over those labels that schedules the redraw this suite races. */
const SPEC = {
  title: "teardown race",
  traces: [{ name: "a", x: [1, 2, 3], y: [1, 4, 9] }],
  xAxis: { title: "x" },
  yAxis: { title: "y" },
};

/**
 * A blank page carrying real Plotly and the built pane module, with every
 * uncaught error and console error recorded.
 *
 * `addScriptTag` resolves when the tag loads, which for a module script is not
 * the same as having evaluated, so the handle is waited for explicitly rather
 * than assumed present.
 */
async function openPaneHarness(
  browser: Browser,
  plotlyDistPath: string,
  fixtureCode: string,
): Promise<{ page: Page; pageErrors: string[] }> {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: plotlyDistPath });
  await page.addScriptTag({ content: fixtureCode, type: "module" });
  await page.waitForFunction(
    (handleName) => (globalThis as unknown as Record<string, unknown>)[handleName] !== undefined,
    PLOTLY_PANE_TEST_HANDLE,
  );
  return { page, pageErrors };
}

/** Per-case budget. Generous enough that a loaded machine cannot fail a case, tight enough that a hang still does -- the same reasoning as `app-routes.e2e.test.ts`. */
const BROWSER_TEST_TIMEOUT = 60_000;

let fixtureCode: string;
let plotlyDistPath: string;

beforeAll(async () => {
  plotlyDistPath = resolvePlotlyDistPath();
  fixtureCode = await buildBrowserFixture();
}, 180_000);

for (const target of BROWSER_TARGETS) {
  describe(
    `Plotly teardown race (P0.118, ${target.name})`,
    { timeout: BROWSER_TEST_TIMEOUT },
    () => {
      let browser: Browser | undefined;

      beforeAll(async () => {
        browser = await tryLaunch(target);
        if (!browser) {
          console.warn(
            `[plotly-teardown-race.e2e.test] Skipping ${target.name}: no usable browser binary in this environment (expected in CI, which installs it explicitly).`,
          );
        }
      }, 180_000);

      afterAll(async () => {
        await browser?.close();
      });

      it("reproduces the reported error deterministically: a purge inside an in-flight newPlot", async () => {
        if (!browser) return;
        const { page } = await openPaneHarness(browser, plotlyDistPath, fixtureCode);
        try {
          // No application code in this case at all. It establishes that the
          // error P0.118 reports is caused by this interleaving and not by
          // something about the app, the suite, or the runner's load -- which is
          // what every earlier attempt at this task could only guess at.
          const rejection = await page.evaluate(async () => {
            const plotly = (
              globalThis as unknown as {
                Plotly: {
                  newPlot: (
                    root: HTMLElement,
                    data: unknown,
                    layout: unknown,
                    config: unknown,
                  ) => Promise<unknown>;
                  purge: (root: HTMLElement) => void;
                };
              }
            ).Plotly;
            const container = document.createElement("div");
            container.style.width = "600px";
            container.style.height = "400px";
            document.body.appendChild(container);

            const plotted = plotly.newPlot(
              container,
              [{ name: "a", x: [1, 2, 3], y: [1, 4, 9], mode: "lines+markers", type: "scatter" }],
              {
                title: "teardown race",
                xaxis: { title: "x" },
                yaxis: { title: "y" },
                margin: { t: 32, r: 8, b: 40, l: 56 },
              },
              { responsive: true, displaylogo: false },
            );
            // Synchronously, before newPlot's own continuation runs. This is the
            // route change arriving mid-mount.
            plotly.purge(container);
            container.remove();
            try {
              await plotted;
              return null;
            } catch (error) {
              return (error as Error).message;
            }
          });

          expect(rejection).toContain(REDRAW_ERROR);
        } finally {
          await page.close();
        }
      });

      it("survives that same interleaving through renderLazyPlotlyPane and disposeLazyPlotlyPane", async () => {
        if (!browser) return;
        const { page, pageErrors } = await openPaneHarness(browser, plotlyDistPath, fixtureCode);
        try {
          const outcome = await page.evaluate(
            async ([handleName, spec]) => {
              const pane = (
                globalThis as unknown as Record<
                  string,
                  {
                    render: (c: HTMLElement, s: unknown) => Promise<void>;
                    dispose: (c: HTMLElement) => Promise<void>;
                  }
                >
              )[handleName]!;
              const container = document.createElement("div");
              container.style.width = "600px";
              container.style.height = "400px";
              document.body.appendChild(container);

              // Exactly what `LazyPlotlyView`'s effect and its cleanup do when a
              // route change lands while the pane is still mounting: the render
              // is started and the teardown is requested in the same tick,
              // before the render can have reached Plotly.
              const rendered = pane.render(container, spec);
              const disposed = pane.dispose(container);
              container.remove();

              const settle = async (work: Promise<void>): Promise<string | null> => {
                try {
                  await work;
                  return null;
                } catch (error) {
                  return (error as Error).message;
                }
              };
              const renderError = await settle(rendered);
              const disposeError = await settle(disposed);
              // Give any redraw the mount scheduled a chance to run and throw.
              await new Promise((resolve) => setTimeout(resolve, 250));
              return { renderError, disposeError };
            },
            [PLOTLY_PANE_TEST_HANDLE, SPEC] as const,
          );

          expect(outcome.renderError).toBeNull();
          expect(outcome.disposeError).toBeNull();
          expect(pageErrors).toEqual([]);
        } finally {
          await page.close();
        }
      });

      it("never plots into a container whose caller gave up during the import", async () => {
        if (!browser) return;
        const { page, pageErrors } = await openPaneHarness(browser, plotlyDistPath, fixtureCode);
        try {
          // The other half of the fix, and the other interleaving: the caller is
          // gone by the time the import resolves, so the mount must not happen at
          // all. Plotly stamps `_fullLayout` on any div it has plotted into, so
          // its absence is the direct observation that nothing was mounted --
          // stronger than asserting no error, since an orphaned `responsive: true`
          // plot on a detached node is a leak whether or not it throws today.
          const plotted = await page.evaluate(
            async ([handleName, spec]) => {
              const pane = (
                globalThis as unknown as Record<
                  string,
                  {
                    render: (
                      c: HTMLElement,
                      s: unknown,
                      o: { shouldMount: () => boolean },
                    ) => Promise<void>;
                  }
                >
              )[handleName]!;
              const container = document.createElement("div");
              container.style.width = "600px";
              container.style.height = "400px";
              document.body.appendChild(container);

              let live = true;
              const rendered = pane.render(container, spec, { shouldMount: () => live });
              live = false;
              container.remove();
              await rendered;
              await new Promise((resolve) => setTimeout(resolve, 250));
              return (container as unknown as { _fullLayout?: unknown })._fullLayout !== undefined;
            },
            [PLOTLY_PANE_TEST_HANDLE, SPEC] as const,
          );

          expect(plotted).toBe(false);
          expect(pageErrors).toEqual([]);
        } finally {
          await page.close();
        }
      });
    },
  );
}
