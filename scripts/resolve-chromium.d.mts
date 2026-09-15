// Types for `resolve-chromium.mjs` (P0.138).
//
// The helper is authored as plain `.mjs` because the three GPU scripts that use
// it are plain Node ESM and run without a build step — they have to, since they
// are what verifies the build's output. This declaration exists so the one
// consumer inside the TypeScript program (`resolve-chromium.test.ts`) is
// type-checked rather than silently `any`, which is what `noImplicitAny`
// refused and was right to refuse.
//
// Keep it in step with the implementation by hand. It is small, and the
// alternative — moving the helper into a package — would make the scripts
// depend on `dist/`, which is the coupling P0.137 was filed about.

/** The environment variable that overrides browser selection. */
export const OVERRIDE_VAR: "BALLISTA_CHROMIUM_PATH";

/** The environment variable naming Playwright's browser root. */
export const BROWSERS_PATH_VAR: "PLAYWRIGHT_BROWSERS_PATH";

/** A full-Chromium build found by the probe. `revision` is -1 when unnumbered. */
export interface ChromiumCandidate {
  path: string;
  revision: number;
}

/** How the executable was decided. See `resolveChromiumExecutable`. */
export type ChromiumSource = "override" | "probe" | "playwright";

export interface ChromiumResolution {
  /** `undefined` means "leave Playwright's own resolution alone". */
  executablePath: string | undefined;
  source: ChromiumSource;
  candidates: ChromiumCandidate[];
}

/** The filesystem calls the probe makes, injectable for tests. */
export interface ChromiumFs {
  readdirSync: (root: string) => string[];
  existsSync: (path: string) => boolean;
}

export function isHeadlessShellPath(path: string): boolean;

export function findChromiumBuilds(root: string | undefined, fs?: ChromiumFs): ChromiumCandidate[];

export function resolveChromiumExecutable(
  env?: Record<string, string | undefined>,
  fs?: ChromiumFs,
): ChromiumResolution;

export function chromiumChoiceLine(resolution: ChromiumResolution): string;

export function chromiumHintLines(resolution: ChromiumResolution): string[];
