// Find a Chromium that can actually give us a WebGPU device, and say so when we
// cannot. Shared by the three GPU scripts (P0.138).
//
// ## The bug this exists to close
//
// Playwright resolves a browser build pinned to its own version. This project's
// container ships a different revision, so the default resolution points at a
// directory that is not there and the launch fails with:
//
//     Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1228/...
//
// That reads like "Playwright was never installed". It is not: a perfectly good
// Chromium sits next to it under the same `PLAYWRIGHT_BROWSERS_PATH`, at a
// different revision. `BALLISTA_CHROMIUM_PATH` has always been able to point at
// it, and setting it obtains a (software) device immediately — but that
// variable was documented in one script's header comment and read by three
// scripts, so the message reporting the failure never mentioned the remedy.
//
// The cost was not hypothetical. The 104th run recorded "No WebGPU adapter in
// this container" and deferred the GPU *correctness* checks to hardware nobody
// had supplied; the 105th run found the adapter had been reachable all along
// and that only the binary path was in the way.
//
// ## Both halves of P0.138's criterion, deliberately
//
// The criterion offers "obtains a device with no hand-set environment variable,
// **or** prints a message naming the binary it wants and the variable that
// overrides it". This module does both, because neither alone is enough:
//
//   * `resolveChromiumExecutable` probes for a usable build, so the common case
//     needs no environment at all.
//   * `chromiumHintLines` produces the remedy text, because on a machine that
//     ships no Chromium the probe finds nothing and the message is the entire
//     fix available to the reader.
//
// ## What this module must NOT do
//
// It does not touch `classifyAdapter`, and nothing here may make an adapter
// easier to *mislabel*. Making a device easier to obtain is only safe while a
// software one is still recorded as software — P7.15's whole reading rests on
// that, and a probe that found a device is not evidence about what kind it is.
//
// ## Why the headless shell is rejected
//
// `chrome-headless-shell-*` builds are present in the same tree and match the
// same version globs, and they are useless here: WebGPU needs the GPU process
// the shell does not ship. Preferring one would swap a loud failure ("no
// executable") for a quiet one ("adapter request returned null"), which is the
// worse of the two. So the probe matches full-Chromium directories only, and
// `isHeadlessShellPath` exists to say why a hand-set override that points at a
// shell will not work either.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The override a reader can always fall back on. Named in every message. */
export const OVERRIDE_VAR = "BALLISTA_CHROMIUM_PATH";

/** Where Playwright keeps its browser builds; already set in this container. */
export const BROWSERS_PATH_VAR = "PLAYWRIGHT_BROWSERS_PATH";

/**
 * Directory names we will consider, and the binary inside each.
 *
 * Keyed by platform layout rather than by OS, because a probe that silently
 * matched nothing on macOS would reintroduce exactly this bug there.
 */
const BINARY_SUFFIXES = [
  join("chrome-linux", "chrome"),
  join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
  join("chrome-win", "chrome.exe"),
];

/** A full-Chromium build directory: `chromium`, `chromium-1194`, ... */
const FULL_CHROMIUM_DIR = /^chromium(-(\d+))?$/;

/**
 * True when `path` looks like a headless-shell build.
 *
 * Used for the message rather than for the probe: the probe never selects one,
 * but a human may have pointed the override at one, and "that build has no GPU
 * process" is a far more useful thing to read than "adapter was null".
 */
export function isHeadlessShellPath(path) {
  // Both spellings occur: Playwright's own download is `chromium_headless_shell-<rev>`,
  // and `chrome-headless-shell` appears inside it and in some distributions. A
  // pattern matching only `chrome-` misses the one this container actually has,
  // which is the case the caller most needs explained.
  return /chrom(e|ium)[-_]headless[-_]shell/i.test(path);
}

/**
 * Every full-Chromium binary under `root`, newest revision first.
 *
 * `readdirSync` and `existsSync` are injected so this is testable against a
 * made-up tree. The real defect lived in what the code looked at, not in how it
 * ranked what it found, so the tests need to control the former.
 */
export function findChromiumBuilds(root, fs = { readdirSync, existsSync }) {
  if (!root) return [];
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    // An unreadable or absent browsers directory is not an error here: it means
    // the probe has nothing to offer and the caller falls through to Playwright.
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const match = FULL_CHROMIUM_DIR.exec(entry);
    if (match === null) continue;
    for (const suffix of BINARY_SUFFIXES) {
      const candidate = join(root, entry, suffix);
      if (fs.existsSync(candidate)) {
        // An unnumbered `chromium` directory sorts below every numbered one:
        // where both exist the numbered ones are what Playwright installed.
        found.push({ path: candidate, revision: match[2] ? Number(match[2]) : -1 });
        break;
      }
    }
  }
  found.sort((a, b) => b.revision - a.revision);
  return found;
}

/**
 * Decide which Chromium to launch, and record how the decision was made.
 *
 * Returns `{ executablePath, source, candidates }`. `executablePath` is
 * `undefined` when Playwright's own resolution should be left alone, which is
 * correct on a machine where Playwright installed its pinned revision normally
 * — this module exists for the mismatch case and must not make the ordinary one
 * worse.
 *
 * `source` is one of:
 *   `"override"`  — the environment variable was set; always wins, even if the
 *                   path looks wrong, because second-guessing an explicit
 *                   instruction is how a tool becomes unpredictable.
 *   `"probe"`     — found under PLAYWRIGHT_BROWSERS_PATH.
 *   `"playwright"`— nothing found; Playwright resolves its own.
 */
export function resolveChromiumExecutable(env = process.env, fs = { readdirSync, existsSync }) {
  const override = env[OVERRIDE_VAR];
  if (override) {
    return { executablePath: override, source: "override", candidates: [] };
  }
  const candidates = findChromiumBuilds(env[BROWSERS_PATH_VAR], fs);
  if (candidates.length > 0) {
    return { executablePath: candidates[0].path, source: "probe", candidates };
  }
  return { executablePath: undefined, source: "playwright", candidates };
}

/**
 * One line saying what will be launched, printed before any attempt.
 *
 * Printed unconditionally rather than only on failure: a run that succeeded on
 * a probed binary should say which one, or the next reader cannot tell a
 * reproducible measurement from an accident of what was installed.
 */
export function chromiumChoiceLine(resolution) {
  switch (resolution.source) {
    case "override":
      return `Chromium: ${resolution.executablePath} (from ${OVERRIDE_VAR})`;
    case "probe":
      return `Chromium: ${resolution.executablePath} (found under ${BROWSERS_PATH_VAR})`;
    default:
      return "Chromium: Playwright's own pinned revision (no override set, none found to probe)";
  }
}

/**
 * The remedy text, appended to a "no device could be obtained" warning.
 *
 * Every line here answers a question the bare Playwright error does not: what
 * was tried, what else is available, and what to set. Returns an array so a
 * caller can join it however its own warning is formatted.
 */
export function chromiumHintLines(resolution) {
  const lines = [];
  lines.push(chromiumChoiceLine(resolution));

  if (resolution.source === "override" && isHeadlessShellPath(resolution.executablePath)) {
    lines.push(
      `${OVERRIDE_VAR} points at a headless-shell build. WebGPU needs the GPU ` +
        `process that shell does not ship; point it at a full Chromium binary.`,
    );
  }

  const others = resolution.candidates.filter((c) => c.path !== resolution.executablePath);
  if (others.length > 0) {
    lines.push(
      `Other full Chromium builds found under ${BROWSERS_PATH_VAR}: ` +
        others.map((c) => c.path).join(", "),
    );
  }

  if (resolution.source === "playwright") {
    lines.push(
      `No full Chromium build was found under ${BROWSERS_PATH_VAR}=` +
        `${process.env[BROWSERS_PATH_VAR] ?? "(unset)"}. Playwright resolves a build ` +
        `pinned to its own version, so "Executable doesn't exist" here means a ` +
        `revision mismatch rather than a missing install.`,
    );
  }

  lines.push(
    `To use a specific binary, set ${OVERRIDE_VAR} to a full Chromium ` +
      `executable (not the headless shell).`,
  );
  return lines;
}
