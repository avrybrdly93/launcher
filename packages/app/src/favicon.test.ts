import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, preview } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * P0.116's validation criterion, asserted rather than eyeballed: the app
 * declares an icon that resolves *both* on the dev server and in the built
 * bundle.
 *
 * Why the criterion names both servers. `vite.config.ts` sets `base: "./"`
 * because the build gets embedded at arbitrary subpaths, and the two serve
 * assets by different machinery -- dev serves `public/` straight off the
 * filesystem, the build copies it into `outDir` and rewrites `index.html`.
 * An icon can work in one and 404 in the other, which is the same class of
 * defect the original row was about, so both are checked and the href is
 * read back from the *served* HTML rather than from the source file.
 *
 * WHY THESE ASSERTIONS CHECK THE CONTENT TYPE AND NOT THE STATUS. This is
 * the whole trap in this task, and it was measured rather than guessed.
 * Before the icon existed, `GET /favicon.svg` already returned **200** from
 * both servers -- vite answers an unmatched path with `index.html`. A test
 * written as "the icon request returns 200" therefore passes with no icon
 * file in the repository at all: it would have passed on the exact defect
 * P0.116 exists to fix. That fallback is asserted below in its own case, so
 * the reasoning is a measurement in the suite rather than a comment someone
 * can delete.
 *
 * Why every request happens in the hook instead of in the cases. Both
 * servers are started, probed and closed inside `beforeAll`, and the cases
 * assert over recorded responses. `fetch` leaves its sockets keep-alive and
 * vite's `ViteDevServer.close()` waits for them rather than cutting them: a
 * dev server left open across the cases did not close AT ALL, and a 120 s
 * hook budget timed out exactly as the default 10 s one did, which is how
 * that was told apart from a merely slow teardown. Closing each server in
 * the hook that fetched it takes ~20 ms. Keep new requests in the hook.
 *
 * What this suite deliberately does not do: drive a browser. The browser's
 * unprompted `/favicon.ico` request is issued by the browser process and
 * never appears in Playwright's request events, so the only browser-visible
 * evidence is a console message -- and `app-routes.e2e.test.ts` already
 * asserts on every route that a page load logs no console errors at all.
 * That is the browser-level guard; this is the server-level one, and
 * neither needs to restate the other.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFile = path.join(appRoot, "vite.config.ts");

/** A path no build of this app can contain; used as the fallback control. */
const ABSENT_ASSET = "./no-such-asset-P0116.svg";

interface Probe {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

interface ServerProbe {
  /** The `href` of the `<link rel="icon">` in the HTML this server served. */
  readonly iconHref: string | undefined;
  readonly icon: Probe;
  readonly absentAsset: Probe;
}

let dev: ServerProbe;
let built: ServerProbe;
let outDir: string;

/** The `href` of the document's first `<link rel="icon">`, or `undefined`. */
function iconHref(html: string): string | undefined {
  const link = html.match(/<link\b[^>]*\brel="icon"[^>]*>/i)?.[0];
  return link?.match(/\bhref="([^"]+)"/i)?.[1];
}

async function probe(baseUrl: string, href: string): Promise<Probe> {
  const response = await fetch(new URL(href, baseUrl));
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

/** Fetches the document, its declared icon, and the absent-asset control. */
async function probeServer(baseUrl: string): Promise<ServerProbe> {
  const href = iconHref(await (await fetch(baseUrl)).text());
  return {
    iconHref: href,
    icon: await probe(baseUrl, href ?? ABSENT_ASSET),
    absentAsset: await probe(baseUrl, ABSENT_ASSET),
  };
}

beforeAll(async () => {
  const devServer = await createServer({
    root: appRoot,
    configFile,
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0 },
  });
  await devServer.listen();
  const devUrl = devServer.resolvedUrls?.local[0];
  if (!devUrl) throw new Error("vite dev server did not report a local URL");
  try {
    dev = await probeServer(devUrl);
  } finally {
    devServer.httpServer?.closeAllConnections();
    await devServer.close();
  }

  // Its own temp `outDir`, as both e2e suites do: parallel suites building
  // into the package's `dist/` would race, and none of them should clobber a
  // developer's local build.
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-favicon-"));
  await build({
    root: appRoot,
    configFile,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  const previewServer = await preview({
    root: appRoot,
    configFile,
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const previewUrl = previewServer.resolvedUrls?.local[0];
  if (!previewUrl) throw new Error("vite preview server did not report a local URL");
  try {
    built = await probeServer(previewUrl);
  } finally {
    const httpServer = previewServer.httpServer;
    httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  }
  // Same 180 s budget and the same reasoning as the e2e hooks (P0.106,
  // P0.125): a full build has been measured past 60 s under the parallel
  // suite while passing standalone in half that, and a genuine hang still
  // exceeds 180 s.
}, 180_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("the app's declared icon", () => {
  it("is declared in the source index.html with a relative href", () => {
    const href = iconHref(readFileSync(path.join(appRoot, "index.html"), "utf8"));
    expect(href).toBeDefined();
    // The constraint `base: "./"` puts on every asset URL in that file. A
    // root-relative or absolute href resolves only when the app is served
    // from a domain root, and this bundle is embedded at subpaths too.
    expect(href?.startsWith("/")).toBe(false);
    expect(/^[a-z]+:/i.test(href ?? "")).toBe(false);
  });

  it("resolves to an SVG image on the dev server", () => {
    expect(dev.iconHref).toBeDefined();
    expect(dev.icon.status).toBe(200);
    expect(dev.icon.contentType).toMatch(/^image\//);
    expect(dev.icon.body).toContain("<svg");
  });

  it("resolves to an SVG image in the built bundle", () => {
    expect(built.iconHref).toBeDefined();
    expect(built.icon.status).toBe(200);
    expect(built.icon.contentType).toMatch(/^image\//);
    expect(built.icon.body).toContain("<svg");
  });

  it("is not merely the SPA fallback, which answers any path with a 200", () => {
    // The negative control for the two cases above, and the reason they
    // check the content type at all: both servers answer an asset path they
    // have never heard of with `index.html` and a 200, so status alone
    // cannot tell a served icon from a missing one.
    for (const server of [dev, built]) {
      expect(server.absentAsset.status).toBe(200);
      expect(server.absentAsset.contentType).toMatch(/^text\/html/);
    }
  });
});
