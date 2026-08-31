import { existsSync } from "node:fs";
import { chromium, firefox, type Browser, type BrowserType } from "playwright";

/**
 * Shared browser-acquisition helpers for the app's Playwright suites
 * (P0.114). Extracted verbatim from `app.e2e.test.ts`, which grew them
 * first and now imports them from here -- a second suite needed the same
 * sandbox-vs-CI reasoning, and two copies of a "when is it legitimate to
 * skip a browser test" rule is exactly the kind of duplication that lets
 * the two drift until one silently stops running.
 *
 * This module deliberately holds *only* browser acquisition. Server setup
 * stays with each suite, because the two suites want different servers on
 * purpose: `app.e2e.test.ts` builds and previews (it is about the shipped
 * bundle), this run's route suite drives the dev server (it is about the
 * routes).
 */

/**
 * This sandbox pre-provisions only a (version-mismatched) Chromium binary
 * under a fixed symlink -- the same pattern `canvas-viewport.test.ts` and
 * `worker-pool.e2e.test.ts` already use -- and has no Firefox binary
 * anywhere. Real CI installs both via `playwright install --with-deps
 * chromium firefox` into Playwright's own default cache, where
 * `browserType.launch()` resolves them with no override needed at all (the
 * override below never applies there, since this path does not exist on a
 * CI runner).
 */
export const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

export interface BrowserTarget {
  readonly name: string;
  readonly type: BrowserType;
}

export const BROWSER_TARGETS: readonly BrowserTarget[] = [
  { name: "chromium", type: chromium },
  { name: "firefox", type: firefox },
];

/**
 * Where this environment would actually find `target`'s binary, or
 * `undefined` if it has none. Asks Playwright itself rather than
 * hardcoding a second sandbox path, so the same "does a binary exist here"
 * check works for every browser.
 */
export function resolveExecutablePath(target: BrowserTarget): string | undefined {
  if (target.name === "chromium" && existsSync(SANDBOX_CHROMIUM_PATH)) {
    return SANDBOX_CHROMIUM_PATH;
  }
  try {
    const path = target.type.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Launches `target`, or resolves `undefined` when this environment has no
 * binary for it at all.
 *
 * The `undefined` is a skip signal and nothing more: a `launch()` failure
 * *past* this point means a binary was found and would not start, which is
 * a real problem and is deliberately left to throw. Silently downgrading a
 * genuine CI launch failure to a skip would defeat the "green in CI on
 * Chromium and Firefox" criterion these suites exist to hold.
 */
export async function tryLaunch(target: BrowserTarget): Promise<Browser | undefined> {
  const executablePath = resolveExecutablePath(target);
  if (executablePath === undefined && target.name !== "chromium") {
    return undefined;
  }
  return target.type.launch(executablePath ? { executablePath } : {});
}
