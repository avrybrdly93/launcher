import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page, Request, Response } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_TARGETS, tryLaunch } from "./e2e-browser.js";

/**
 * P0.139's missing half: **a real browser runs the real consumer**.
 *
 * `packages/runtime/src/wasm-core-browser.bundle.test.ts` already builds
 * `wasm-core-browser.bundle-fixture.ts` through Vite and executes the built
 * chunk. It executes it *in Node, with a stubbed `fetch`*, which its own
 * header is candid about. P0.139's criterion asks for "a test that builds a
 * real consumer **and a browser test that runs it**", and the 140th run's
 * update on that row says in as many words that the first exists and the
 * second does not. This file is the second.
 *
 * ## What is actually different from the Node-side test, since "it runs in a
 * browser" is not by itself an argument
 *
 * Four things that file cannot reach, each of which has its own failure mode:
 *
 * 1. **The URL is resolved by the engine, not by a stub.** The Node test
 *    intercepts `fetch` and answers by *basename*, because it cannot
 *    reproduce what the bundler did to `new URL("./generated/x.wasm",
 *    import.meta.url)`. Here nothing intercepts anything: whatever the
 *    bundler wrote is what the engine requests over HTTP, and a wrong
 *    directory is a 404 rather than a basename that happens to match.
 * 2. **`WebAssembly` is the engine's.** `wasmSimdSupported()` validates a
 *    43-byte probe module, and Node's answer to that is Node's. Whether a
 *    browser accepts the simd128 artifact is a different question that only
 *    a browser can answer.
 * 3. **The response is a real `Response`.** The stub returns a hand-built
 *    object with `ok`, `status` and `arrayBuffer`. A real one carries a MIME
 *    type, and `application/wasm` is the thing
 *    `WebAssembly.instantiateStreaming` refuses to proceed without.
 * 4. **Module-graph loading is the engine's.** The built chunk is `import()`ed
 *    by Node there; here it is a `<script type="module">` fetched and linked
 *    by the browser.
 *
 * ## What this file deliberately does NOT do
 *
 * *Define its own probe.* It runs `probeBrowserKernels` -- the same fixture,
 * imported by `wasm-core-browser.e2e-entry.ts` and by nothing else new. A
 * second copy of the criterion in a second file is a second thing to keep in
 * agreement, and the two would drift silently because each would pass on its
 * own.
 *
 * *Say anything about speed.* P0.139's note is explicit: "DO NOT TREAT THIS
 * AS A PERFORMANCE TASK." The criterion is reachability. No timing is taken
 * here and none should be added.
 *
 * *Widen `BROWSER_CPU_BACKENDS`.* That is P0.133, which is blocked on P0.162.
 * This file proves the kernels are reachable from a browser; what the app
 * then routes onto is a separate, and currently human-gated, question.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.resolve(appRoot, "..", "runtime", "src");
const PAGE = "wasm-core-browser.e2e-page.html";

let server: PreviewServer;
let pageUrl: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-wasm-browser-e2e-"));
  const common = {
    root: fixtureRoot,
    configFile: false as const,
    logLevel: "warn" as const,
  };
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: true,
      // The load-bearing option, and the same one the Node-side test gives
      // its own reason for. An inlined artifact turns the fetch this suite
      // exists to exercise into a `data:` URL that never touches the server,
      // while every numeric assertion below still passes.
      assetsInlineLimit: 0,
      rollupOptions: { input: path.join(fixtureRoot, PAGE) },
    },
  });
  server = await preview({
    ...common,
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error("vite preview server did not report a local URL");
  pageUrl = new URL(PAGE, address).href;
  // P0.106's reasoning, and the same 180 s the other e2e hooks use: this hook
  // vite-builds a fixture and launches a browser, and under the full parallel
  // suite that class of hook has been measured past 60 s while passing
  // standalone minutes later.
}, 180_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  }
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/** The shape `wasm-core-browser.e2e-entry.ts` parks on the page. */
interface ProbeResult {
  readonly scalarFinal: readonly number[];
  readonly bestFinal: readonly number[];
  readonly bestHasSimd: boolean;
  readonly simdSupported: boolean;
  readonly explicitSimdHasSimd: boolean | undefined;
  readonly explicitSimdFinal: readonly number[] | undefined;
}
type ProbeOutcome =
  | { readonly ok: true; readonly probe: ProbeResult }
  | { readonly ok: false; readonly error: string };

interface PageRun {
  readonly probe: ProbeResult;
  /** Basenames of every `.wasm` the engine actually requested over HTTP. */
  readonly wasmRequests: readonly string[];
  /** Every request URL, so an inlined artifact is distinguishable from a missing one. */
  readonly allRequests: readonly string[];
  /** Response status for each request URL, so a 404 fails here and not downstream. */
  readonly statuses: ReadonlyMap<string, number>;
  readonly consoleErrors: readonly string[];
}

/**
 * Opens the fixture in `browser`, waits for the probe to settle, and returns
 * it together with what the engine asked the server for.
 *
 * The request log is assertion material rather than a diagnostic: it is the
 * only thing that distinguishes "the browser fetched and instantiated two
 * WASM binaries" from "the bundler inlined them and the numbers came out the
 * same anyway". The Node-side test needs `expect(served.length)` for the same
 * reason; here the observer is the browser's own network stack.
 */
async function runInBrowser(browser: Browser): Promise<PageRun> {
  const page: Page = await browser.newPage();
  const allRequests: string[] = [];
  const statuses = new Map<string, number>();
  const consoleErrors: string[] = [];
  page.on("request", (request: Request) => allRequests.push(request.url()));
  page.on("response", (response: Response) => statuses.set(response.url(), response.status()));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await page.goto(pageUrl, { waitUntil: "load" });
    await page.waitForFunction(
      (slot: string) => (globalThis as Record<string, unknown>)[slot] !== undefined,
      "__ballistaWasmBrowserProbe",
      { timeout: 60_000 },
    );
    const outcome = (await page.evaluate(
      (slot: string) => (globalThis as Record<string, unknown>)[slot],
      "__ballistaWasmBrowserProbe",
    )) as ProbeOutcome;
    // Surfaced as the failure message rather than as an undefined-property
    // read three assertions later: a rejection inside a module script is
    // otherwise silent, and the entry module carries the stack across for
    // exactly this line.
    expect(outcome.ok, outcome.ok ? "" : `probe threw in the browser:\n${outcome.error}`).toBe(
      true,
    );
    return {
      probe: (outcome as { probe: ProbeResult }).probe,
      wasmRequests: allRequests
        .filter((url) => new URL(url).pathname.endsWith(".wasm"))
        .map((url) => path.basename(new URL(url).pathname)),
      allRequests,
      statuses,
      consoleErrors,
    };
  } finally {
    await page.close();
  }
}

describe.each(BROWSER_TARGETS)("wasm-core in a real browser (P0.139): $name", (target) => {
  let browser: Browser | undefined;

  beforeAll(async () => {
    browser = await tryLaunch(target);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
  });

  /**
   * `tryLaunch` returns `undefined` only when this environment has no binary
   * for the target at all; a binary that is present and will not start is
   * left to throw. That contract is `e2e-browser.ts`'s and is not relaxed
   * here.
   */
  const itWithBrowser = (name: string, body: (run: PageRun) => void | Promise<void>): void => {
    it(
      name,
      async () => {
        if (!browser) {
          expect(target.name).not.toBe("chromium");
          return;
        }
        await body(await runInBrowser(browser));
      },
      120_000,
    );
  };

  itWithBrowser("fetches both committed artifacts over HTTP rather than inlining them", (run) => {
    // The control for every numeric assertion in this file. Without it, a
    // build that inlined the artifacts as `data:` URIs would satisfy all of
    // them while making the word "fetch" false.
    expect(run.wasmRequests.length).toBeGreaterThan(0);
    expect(run.allRequests.every((url) => !url.startsWith("data:"))).toBe(true);
    expect(run.wasmRequests.some((name) => name.startsWith("ballista-core"))).toBe(true);

    // And every resource the fixture references was actually served. A 404 on
    // an artifact otherwise surfaces downstream as a WebAssembly magic-number
    // complaint against an HTML error page, which sends the reader looking at
    // the kernel instead of at the deployment -- `fetchArtifact` raises a
    // labelled error for that same reason.
    //
    // Asserted on the RESPONSE STATUSES of the page's own requests, not on
    // console silence. Chromium probes `/favicon.ico` on any page that
    // declares none and logs the 404 it gets back; that says nothing about
    // this fixture, and an assertion it can trip is an assertion about the
    // browser's conventions rather than about the code under test. Measured,
    // not anticipated: the first version of this case asserted
    // `consoleErrors` was empty and failed on exactly that.
    const fixtureResources = run.allRequests.filter((url) =>
      /\.(?:html|js|wasm)$/.test(new URL(url).pathname),
    );
    // The page, its entry chunk, and both artifacts.
    expect(fixtureResources.length).toBeGreaterThanOrEqual(4);
    // 200 OR 304, and the second one is not a loosening. The three cases in
    // this describe block share one browser, so each opens a page against a
    // server that has already served these files once; Firefox revalidates
    // from its HTTP cache and is answered `304 Not Modified`, which means the
    // request reached the server and the resource is current. Chromium in the
    // sandbox this was written in serves them fresh each time and never
    // produced one, which is why the first version of this assertion said
    // `toBe(200)` and was green locally while red on CI, where ci.yml installs
    // a Firefox binary and `tryLaunch` therefore does not skip.
    //
    // This is the same lesson as the `/favicon.ico` one three paragraphs up,
    // applied a second time: an assertion a browser's caching conventions can
    // trip is an assertion about the browser, not about the code under test.
    // What the case exists to catch is a resource the deployment did not
    // serve -- a 404 surfacing downstream as a WebAssembly magic-number
    // complaint -- and 404, 403, 500 and a missing entry all still fail here.
    for (const url of fixtureResources) {
      const status = run.statuses.get(url);
      expect(status, `${url} was requested but got no response`).not.toBeUndefined();
      expect(
        [200, 304],
        `${url} was requested but was not served (got ${String(status)}; expected 200, or 304 from a revalidated cache)`,
      ).toContain(status);
    }
    // Kept as a diagnostic rather than an assertion: an error mentioning one
    // of the fixture's own resources would already have failed above.
    expect(run.consoleErrors.some((line) => line.includes(".wasm"))).toBe(false);
  });

  itWithBrowser("instantiates the scalar kernel and integrates a flight with it", (run) => {
    expect(run.probe.scalarFinal).toHaveLength(4);
    for (const value of run.probe.scalarFinal) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // A kernel that instantiated but never stepped would hand back the
    // fixture's initial state. Checked against that initial condition rather
    // than a golden number: this row is about reachability, and the values
    // are pinned to 0 ULP by backend-equivalence.test.ts already.
    expect(run.probe.scalarFinal[0]).toBeGreaterThan(0);
    expect(run.probe.scalarFinal.slice(0, 2)).not.toEqual([0, 0]);
  });

  itWithBrowser("instantiates the simd128 kernel by name, not by fallback", (run) => {
    if (!run.probe.simdSupported) {
      // Recorded rather than silently passed, and the same branch the
      // Node-side test carries: on an engine that does not validate the
      // simd128 proposal, this half of the criterion is untestable here and
      // the scalar half above is what stands.
      expect(run.probe.explicitSimdHasSimd).toBeUndefined();
      expect(run.probe.bestHasSimd).toBe(false);
      return;
    }

    expect(run.probe.explicitSimdHasSimd).toBe(true);
    expect(run.probe.bestHasSimd).toBe(true);

    // Bit-identical, not close. Each SIMD lane is an independent replicate
    // and simd128 has no FMA, so there is no reassociation to explain a
    // difference; one here would mean the browser was handed the wrong bytes.
    expect(run.probe.explicitSimdFinal).toBeDefined();
    for (const [i, value] of run.probe.scalarFinal.entries()) {
      expect(Object.is(run.probe.explicitSimdFinal![i], value)).toBe(true);
      expect(Object.is(run.probe.bestFinal[i], value)).toBe(true);
    }
  });
});
