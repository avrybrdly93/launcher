// P0.138 guard: the GPU scripts find a browser, and say what to do when they cannot.
//
// ## What went wrong
//
// Playwright resolves a Chromium build pinned to its own version. This
// project's container ships a different revision under the same
// `PLAYWRIGHT_BROWSERS_PATH`, so the default resolution pointed at nothing and
// every GPU script reported:
//
//     Executable doesn't exist at .../chromium_headless_shell-1228/...
//
// which reads as "Playwright was never installed". `BALLISTA_CHROMIUM_PATH`
// could always fix it, and was documented inside one script's header while
// being read by three. The 104th run concluded from that message that there was
// no WebGPU adapter in this container and deferred the GPU correctness checks
// to hardware nobody had supplied; the 105th run found the adapter had been
// reachable the whole time.
//
// ## Why these assertions and not an end-to-end run
//
// The honest end-to-end check is `pnpm bench:gpu-workgroup` obtaining a device,
// and it takes minutes and needs a browser — it belongs in the scripts, which
// is where it was run to close the task. What can be held here cheaply is the
// *decision*: which binary gets chosen, in what order of preference, and what
// the message says when nothing is found. `findChromiumBuilds` takes its
// filesystem as an argument precisely so that decision can be driven over trees
// this machine does not have, including the Windows and macOS layouts that
// would otherwise only be exercised by someone running on those platforms.
//
// One case here is the whole point and would be easy to lose in a later
// refactor: **a headless-shell build must never be selected.** It matches the
// same version glob and it cannot do WebGPU, so preferring one would trade a
// loud failure ("no executable") for a quiet one ("adapter was null"), which is
// strictly worse. If `SELECTS_FULL_CHROMIUM` below ever fails, that is what has
// regressed.

import { describe, expect, it } from "vitest";
import { join } from "node:path";

// The module under test is a plain .mjs script helper, imported directly rather
// than through a package entry point: it is script-side code and deliberately
// not part of any package's public surface. Its types come from the hand-written
// `resolve-chromium.d.mts` beside it -- see that file for why it is not a package.
import {
  BROWSERS_PATH_VAR,
  OVERRIDE_VAR,
  chromiumChoiceLine,
  chromiumHintLines,
  findChromiumBuilds,
  isHeadlessShellPath,
  resolveChromiumExecutable,
} from "../../../scripts/resolve-chromium.mjs";

/**
 * A stand-in filesystem: `dirs` are the entries under the browsers root and
 * `files` are the paths that exist.
 */
function fakeFs(dirs: string[], files: string[]) {
  return {
    readdirSync: (root: string) => {
      if (root !== ROOT) throw new Error(`ENOENT: ${root}`);
      return dirs;
    },
    existsSync: (path: string) => files.includes(path),
  };
}

const ROOT = "/opt/pw-browsers";
const LINUX = join("chrome-linux", "chrome");
const MAC = join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
const WIN = join("chrome-win", "chrome.exe");

/** The layout this container actually has, measured 2026-09-15. */
const CONTAINER_DIRS = ["chromium", "chromium-1194", "chromium_headless_shell-1194", "ffmpeg-1011"];
const CONTAINER_FILES = [
  join(ROOT, "chromium-1194", LINUX),
  join(ROOT, "chromium_headless_shell-1194", LINUX),
];

describe("findChromiumBuilds", () => {
  it("finds the full Chromium this container supplies", () => {
    const found = findChromiumBuilds(ROOT, fakeFs(CONTAINER_DIRS, CONTAINER_FILES));
    expect(found.map((c: { path: string }) => c.path)).toEqual([
      join(ROOT, "chromium-1194", LINUX),
    ]);
  });

  // SELECTS_FULL_CHROMIUM -- see this file's header. The headless shell matches
  // the same version scheme and cannot do WebGPU; selecting one would turn a
  // loud failure into a silent null adapter.
  it("never selects a headless-shell build, even when it is the only one there", () => {
    const found = findChromiumBuilds(
      ROOT,
      fakeFs(
        ["chromium_headless_shell-1194", "chrome-headless-shell-1228"],
        [
          join(ROOT, "chromium_headless_shell-1194", LINUX),
          join(ROOT, "chrome-headless-shell-1228", LINUX),
        ],
      ),
    );
    expect(found).toEqual([]);
  });

  it("prefers the newest revision when several full builds exist", () => {
    const dirs = ["chromium-1194", "chromium-1228", "chromium-980"];
    const found = findChromiumBuilds(
      ROOT,
      fakeFs(
        dirs,
        dirs.map((d) => join(ROOT, d, LINUX)),
      ),
    );
    expect(found.map((c: { revision: number }) => c.revision)).toEqual([1228, 1194, 980]);
  });

  it("sorts an unnumbered `chromium` directory below every numbered one", () => {
    // Both exist in this container. The numbered ones are what Playwright
    // installed and carry a revision we can reason about; the bare name does not.
    const dirs = ["chromium", "chromium-1194"];
    const found = findChromiumBuilds(
      ROOT,
      fakeFs(
        dirs,
        dirs.map((d) => join(ROOT, d, LINUX)),
      ),
    );
    expect(found.map((c: { path: string }) => c.path)).toEqual([
      join(ROOT, "chromium-1194", LINUX),
      join(ROOT, "chromium", LINUX),
    ]);
  });

  it("finds the macOS and Windows layouts too", () => {
    // Not reachable on this machine, which is exactly why it is asserted: a
    // probe that silently matched nothing off Linux would reintroduce this bug
    // there and nobody here would see it.
    for (const suffix of [MAC, WIN]) {
      const found = findChromiumBuilds(
        ROOT,
        fakeFs(["chromium-1194"], [join(ROOT, "chromium-1194", suffix)]),
      );
      expect(found.map((c: { path: string }) => c.path)).toEqual([
        join(ROOT, "chromium-1194", suffix),
      ]);
    }
  });

  it("returns nothing rather than throwing when the root is absent or unset", () => {
    expect(findChromiumBuilds("/nope", fakeFs(CONTAINER_DIRS, CONTAINER_FILES))).toEqual([]);
    expect(findChromiumBuilds(undefined, fakeFs(CONTAINER_DIRS, CONTAINER_FILES))).toEqual([]);
  });

  it("ignores a directory whose binary is not actually there", () => {
    // A half-removed install: the directory survives, the executable does not.
    expect(findChromiumBuilds(ROOT, fakeFs(["chromium-1194"], []))).toEqual([]);
  });
});

describe("resolveChromiumExecutable", () => {
  const fs = fakeFs(CONTAINER_DIRS, CONTAINER_FILES);

  it("probes when nothing is set, which is the case that closes P0.138", () => {
    const resolution = resolveChromiumExecutable({ [BROWSERS_PATH_VAR]: ROOT }, fs);
    expect(resolution.source).toBe("probe");
    expect(resolution.executablePath).toBe(join(ROOT, "chromium-1194", LINUX));
  });

  it("lets an explicit override win over anything it could probe", () => {
    // Even though a probe would succeed here. Second-guessing an explicit
    // instruction is how a tool stops being predictable.
    const resolution = resolveChromiumExecutable(
      { [BROWSERS_PATH_VAR]: ROOT, [OVERRIDE_VAR]: "/somewhere/chrome" },
      fs,
    );
    expect(resolution.source).toBe("override");
    expect(resolution.executablePath).toBe("/somewhere/chrome");
  });

  it("leaves Playwright's own resolution alone when there is nothing to probe", () => {
    // The ordinary case on a normally-installed machine. This module exists for
    // the revision-mismatch case and must not make the working one worse.
    const resolution = resolveChromiumExecutable({}, fs);
    expect(resolution.source).toBe("playwright");
    expect(resolution.executablePath).toBeUndefined();
  });
});

describe("the message printed when no device could be obtained", () => {
  // The second branch of P0.138's criterion, verbatim: "prints a message naming
  // the binary it wants and the variable that overrides it".
  it("names the override variable in every case", () => {
    const cases = [
      resolveChromiumExecutable({}, fakeFs([], [])),
      resolveChromiumExecutable(
        { [BROWSERS_PATH_VAR]: ROOT },
        fakeFs(CONTAINER_DIRS, CONTAINER_FILES),
      ),
      resolveChromiumExecutable({ [OVERRIDE_VAR]: "/somewhere/chrome" }, fakeFs([], [])),
    ];
    for (const resolution of cases) {
      expect(chromiumHintLines(resolution).join("\n")).toContain(OVERRIDE_VAR);
    }
  });

  it("names the binary it would use when it found one", () => {
    const resolution = resolveChromiumExecutable(
      { [BROWSERS_PATH_VAR]: ROOT },
      fakeFs(CONTAINER_DIRS, CONTAINER_FILES),
    );
    expect(chromiumHintLines(resolution).join("\n")).toContain(join(ROOT, "chromium-1194", LINUX));
  });

  it("explains the revision mismatch when it found nothing", () => {
    // The exact confusion that cost the 104th run: "Executable doesn't exist"
    // read as a missing install rather than a version mismatch.
    const text = chromiumHintLines(resolveChromiumExecutable({}, fakeFs([], []))).join("\n");
    expect(text).toContain("revision mismatch");
    expect(text).toContain(BROWSERS_PATH_VAR);
  });

  it("says why a hand-set headless-shell override will not work", () => {
    const resolution = resolveChromiumExecutable(
      { [OVERRIDE_VAR]: join(ROOT, "chromium_headless_shell-1194", LINUX) },
      fakeFs([], []),
    );
    const text = chromiumHintLines(resolution).join("\n");
    expect(text).toContain("headless-shell");
    expect(text).toContain("GPU process");
  });

  it("lists the other builds it did not pick", () => {
    const dirs = ["chromium-1194", "chromium-1228"];
    const resolution = resolveChromiumExecutable(
      { [BROWSERS_PATH_VAR]: ROOT },
      fakeFs(
        dirs,
        dirs.map((d) => join(ROOT, d, LINUX)),
      ),
    );
    const text = chromiumHintLines(resolution).join("\n");
    expect(text).toContain(join(ROOT, "chromium-1194", LINUX));
  });
});

describe("chromiumChoiceLine", () => {
  // Printed on every run, not only on failure: a measurement taken on a probed
  // binary should say which one, or a later reader cannot tell a reproducible
  // result from an accident of what happened to be installed.
  it("distinguishes the three ways a binary can be chosen", () => {
    const fs = fakeFs(CONTAINER_DIRS, CONTAINER_FILES);
    expect(chromiumChoiceLine(resolveChromiumExecutable({ [OVERRIDE_VAR]: "/a" }, fs))).toContain(
      OVERRIDE_VAR,
    );
    expect(
      chromiumChoiceLine(resolveChromiumExecutable({ [BROWSERS_PATH_VAR]: ROOT }, fs)),
    ).toContain(BROWSERS_PATH_VAR);
    expect(chromiumChoiceLine(resolveChromiumExecutable({}, fs))).toContain("pinned revision");
  });
});

describe("isHeadlessShellPath", () => {
  it("recognises both spellings the browser tree uses", () => {
    expect(isHeadlessShellPath("/opt/pw-browsers/chromium_headless_shell-1194/x")).toBe(true);
    expect(isHeadlessShellPath("/opt/pw-browsers/chrome-headless-shell-1228/x")).toBe(true);
    expect(isHeadlessShellPath("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")).toBe(false);
  });
});
