/**
 * Share-URL (§6.3 point 7: "copy-URL (spec compressed into fragment via
 * base64url of deflated JSON)") -- P3.32. `save/load` (localStorage + JSON
 * file, P3.31, `scenario-persistence.ts`) is a separate, already-shipped
 * concern; this is specifically the compressed-into-a-URL-fragment path.
 */
import { migrateScenarioSpec, type ScenarioSpec } from "@ballista/engine";

interface ReadableStreamLike {
  getReader(): {
    read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
  };
}
interface WritableStreamLike {
  getWriter(): {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
  };
}
interface CompressionStreamLike {
  readonly readable: ReadableStreamLike;
  readonly writable: WritableStreamLike;
}
type CompressionFormat = "deflate" | "deflate-raw" | "gzip";

interface WebCodecGlobals {
  TextEncoder: new () => { encode(input: string): Uint8Array };
  TextDecoder: new () => { decode(input: Uint8Array): string };
  CompressionStream: new (format: CompressionFormat) => CompressionStreamLike;
  DecompressionStream: new (format: CompressionFormat) => CompressionStreamLike;
  btoa: (data: string) => string;
  atob: (data: string) => string;
  URL: new (url: string) => { hash: string; toString(): string };
  URLSearchParams: new (init?: string) => { get(name: string): string | null };
}

/**
 * `tsconfig.base.json`'s `lib: ["ES2022"]` deliberately excludes "DOM" (see
 * `simulation-session.ts`'s `defaultFrameScheduler`/`now()`) so this L2
 * package's types don't imply a browser-only environment. The WHATWG
 * globals used below (Compression Streams, `TextEncoder`/`TextDecoder`,
 * `URL`, `btoa`/`atob`) are genuinely available everywhere this code
 * actually runs -- every evergreen browser and Node >=20 (confirmed) --
 * the gap is purely TypeScript's static types, which live only in the
 * "DOM"/"WebWorker" lib bundles this package must not pull in wholesale
 * (hundreds of unrelated globals like `window`/`document`). One structural
 * cast here gives the rest of this module real types without an ambient
 * global declaration that could leak into other packages' compilations.
 */
const globals = globalThis as unknown as WebCodecGlobals;

async function readAllChunks(stream: ReadableStreamLike): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStreamLike): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const writePromise = writer.write(bytes).then(() => writer.close());
  const [result] = await Promise.all([readAllChunks(stream.readable), writePromise]);
  return result;
}

/** Compresses `bytes` with `format` (default `"deflate"`, per §6.3's "deflated JSON"). */
async function deflate(
  bytes: Uint8Array,
  format: CompressionFormat = "deflate",
): Promise<Uint8Array> {
  return pipeThrough(bytes, new globals.CompressionStream(format));
}

/** The exact inverse of {@link deflate}. */
async function inflate(
  bytes: Uint8Array,
  format: CompressionFormat = "deflate",
): Promise<Uint8Array> {
  return pipeThrough(bytes, new globals.DecompressionStream(format));
}

/** Base64url per RFC 4648 §5: `+`/`/` swapped for `-`/`_`, no `=` padding -- safe unescaped in a URL fragment. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return globals.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The exact inverse of {@link bytesToBase64Url}. */
function base64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(paddingNeeded);
  const binary = globals.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Serializes, deflates, and base64url-encodes `spec` -- the exact fragment payload {@link buildShareUrl} embeds. */
export async function encodeScenarioToShareFragment(spec: ScenarioSpec): Promise<string> {
  const json = JSON.stringify(spec);
  const compressed = await deflate(new globals.TextEncoder().encode(json));
  return bytesToBase64Url(compressed);
}

/**
 * The exact inverse of {@link encodeScenarioToShareFragment}: base64url-decodes,
 * inflates, parses, and migrates back to a current-schema `ScenarioSpec`
 * (via `migrateScenarioSpec`, so a link shared from an older app version
 * still loads). Throws on a malformed/corrupt fragment; {@link
 * parseShareUrl} is the caller that wants a `null` fallback instead.
 */
export async function decodeScenarioFromShareFragment(fragment: string): Promise<ScenarioSpec> {
  const compressed = base64UrlToBytes(fragment);
  const bytes = await inflate(compressed);
  const json = new globals.TextDecoder().decode(bytes);
  return migrateScenarioSpec(JSON.parse(json));
}

/** The URL fragment key `buildShareUrl`/`parseShareUrl` use, e.g. `#s=<encoded>`. */
const SHARE_FRAGMENT_KEY = "s";

/** Builds a shareable URL: `base` with its fragment replaced by the compressed, encoded `spec`. */
export async function buildShareUrl(base: string, spec: ScenarioSpec): Promise<string> {
  const url = new globals.URL(base);
  const encoded = await encodeScenarioToShareFragment(spec);
  url.hash = `${SHARE_FRAGMENT_KEY}=${encoded}`;
  return url.toString();
}

/**
 * Reads the `ScenarioSpec` back out of a URL built by {@link buildShareUrl}
 * (§6.3's "load on boot"). Returns `null` -- rather than throwing -- when
 * there is no share fragment, or when the fragment fails to decode/migrate
 * (corrupt link, incompatible future version), so a caller can fall back to
 * its own default scenario instead of failing to boot.
 */
export async function parseShareUrl(url: string): Promise<ScenarioSpec | null> {
  const hash = new globals.URL(url).hash;
  if (!hash) return null;
  const params = new globals.URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const encoded = params.get(SHARE_FRAGMENT_KEY);
  if (!encoded) return null;
  try {
    return await decodeScenarioFromShareFragment(encoded);
  } catch {
    return null;
  }
}
