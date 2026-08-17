// P0.102 regression guard: `pnpm check:cross-engine-drift` must never quietly
// overwrite its own committed evidence.
//
// What went wrong. `scripts/measure-cross-engine-drift.mjs` ended by
// unconditionally writing `scripts/cross-engine-drift-results.json`, which is
// committed and held a real chromium measurement (maxRelativeDrift 0,
// bit-identical over 101 rows x 5 series). That script is part of the
// documented pre-push gate. Run in any environment lacking Playwright's exact
// browser revisions -- every dev sandbox -- it recorded both engines as
// `status: unavailable` with a launcher stack trace as the `reason`, replaced
// the file's provenance paragraph with a generic one, printed "All measured
// engines are within the drift threshold", and exited 0. Zero measured engines
// satisfies that sentence vacuously, so a soft-warn check downgraded checked-in
// evidence to a non-measurement and reported success. The 30th run caught it
// only by reading `git status` line by line, and reverted by hand.
//
// The two properties worth guarding, since neither fails anything else:
//   1. writing is opt-in (--record), so a local gate run cannot write at all;
//   2. even --record refuses when nothing was measured, so a CI run whose
//      `playwright install` failed cannot erase a good record either.
//
// These run the real script as a subprocess (~0.7 s each) rather than asserting
// on its source, because the property under test is what it does to a file on
// disk. Where the test needs "no engine could be measured" to hold
// deterministically it forces PLAYWRIGHT_BROWSERS_PATH at a path that does not
// exist -- otherwise this file would behave differently on the CI runner, where
// the browsers are real, and case 2 would itself perform the write it exists to
// forbid.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "measure-cross-engine-drift.mjs");
const RESULTS = join(REPO_ROOT, "scripts", "cross-engine-drift-results.json");

/** A browsers path that cannot resolve, forcing every engine to `unavailable`. */
const NO_BROWSERS = join(REPO_ROOT, "node_modules", ".p0102-no-such-browsers");

/**
 * Combined stdout+stderr. The `::warning::` annotations this script uses for
 * every "could not measure" signal go to stderr via console.warn, so a
 * stdout-only capture silently sees none of them.
 */
function runScript(args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/** Exact bytes, so a reordered-but-equivalent rewrite still counts as a modification. */
function resultsBytes(): string {
  return readFileSync(RESULTS, "utf8");
}

describe("cross-engine drift check: writing the committed results file", () => {
  it("does not touch the committed results file when run without --record", () => {
    const before = resultsBytes();
    runScript([]);
    expect(resultsBytes()).toBe(before);
  });

  it("says so, rather than writing, when not asked to record", () => {
    const output = runScript([]);
    expect(output).toContain("Not writing");
    expect(output).toContain("--record");
  });

  it("refuses to write even with --record when no engine could be measured", () => {
    const before = resultsBytes();
    const output = runScript(["--record"], { PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS });
    expect(resultsBytes()).toBe(before);
    expect(output).toContain("no engine was measured");
  });

  it("never reports an all-clear derived from zero measured engines", () => {
    const output = runScript([], { PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS });
    // The exact sentence that made the original defect look like a pass.
    expect(output).not.toContain("All measured engines are within the drift threshold");
    expect(output).toContain("No engine could be measured");
    expect(output).toContain("This is not a pass");
  });
});

describe("cross-engine drift check: CI still records", () => {
  // Making writing opt-in is only safe if the one environment with real
  // browsers still opts in. If this assertion ever fails, the committed
  // measurement has quietly become frozen at whatever it last held.
  const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

  it("passes --record on the CI runner", () => {
    expect(workflow).toContain("check:cross-engine-drift --record");
  });
});
