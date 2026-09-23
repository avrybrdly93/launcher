// P0.90 regression guard: the root `pnpm build` script must actually run.
//
// Why this file exists at all. `package.json`'s root build script was
// `pnpm -r --workspace-concurrency 1 run build`. Under the pnpm version this repo
// pins itself (`packageManager: pnpm@11.9.0`) that exits 1 with
// ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT — pnpm reads the space-separated flag value as
// consuming the next token, so `run` becomes the script name and it goes looking
// for a "run" script in the packages that do not have one. The `=` form
// (`--workspace-concurrency=1`) parses correctly and builds them all. (There were
// eight packages when this was written; wasm-core made nine in P7.07.)
//
// The fix is one character. It took the repo eleven changelog entries and three
// duplicate task filings (P0.90, P0.93, P0.104 — filed as P1.01, renamed by
// P0.100 because that id collided with a real phase-1 task) to land, because nothing failed
// when it regressed: CLAUDE.md names `build` in the pre-push gate every session is
// told to run, but CI never calls the root script — `.github/workflows/ci.yml`
// invokes `pnpm --filter @ballista/app build` directly, which is green either way.
// So the breakage was visible only to whoever typed `pnpm build`, and each session
// that tripped over it filed a fresh task instead of fixing it.
//
// These tests are the missing signal. They are string assertions on package.json
// rather than an actual build because a real recursive build takes ~35 s, which
// does not belong in the unit suite — the failure mode being guarded is a
// mis-typed flag, and that is exactly what a string assertion catches.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

const rootPkg = readPackageJson(join(REPO_ROOT, "package.json"));
const rootScripts = rootPkg.scripts ?? {};

/** Workspace packages, i.e. every directory under packages/ carrying a package.json. */
function workspacePackages(): { dir: string; pkg: PackageJson }[] {
  return readdirSync(PACKAGES_DIR)
    .map((dir) => ({ dir, manifest: join(PACKAGES_DIR, dir, "package.json") }))
    .filter(({ manifest }) => existsSync(manifest))
    .map(({ dir, manifest }) => ({ dir, pkg: readPackageJson(manifest) }));
}

describe("root package.json scripts", () => {
  // pnpm's own flags that take a value. Written as a list so the assertion below
  // generalises: the defect is the space-separated form in a script that also
  // carries a subcommand, not anything specific to --workspace-concurrency.
  const VALUE_FLAGS = ["--workspace-concurrency", "--filter", "--reporter", "--use-node-version"];

  it("never passes a pnpm value-flag in the space-separated form before a subcommand", () => {
    const offenders: string[] = [];
    for (const [name, body] of Object.entries(rootScripts)) {
      for (const flag of VALUE_FLAGS) {
        // `--flag value` (space) rather than `--flag=value`.
        const spaceForm = new RegExp(`${flag}\\s+[^\\s=]`);
        if (spaceForm.test(body)) offenders.push(`${name}: ${body}`);
      }
    }
    expect(
      offenders,
      "use --flag=value; pnpm 11 folds the next token into a space-separated value",
    ).toEqual([]);
  });

  it("has a build script that recurses over the workspace", () => {
    const build = rootScripts.build;
    expect(build, "root package.json must define a build script").toBeDefined();
    expect(build).toContain("-r");
    expect(build).toContain("build");
  });

  it("does not name `run` as the script pnpm should execute", () => {
    // The precise shape of the P0.90 defect: whatever token follows `run` is the
    // script name, so `run` must never be the last word, and the token before it
    // must not be a flag value position.
    const build = rootScripts.build ?? "";
    expect(build.trim().endsWith("run")).toBe(false);
    expect(build).not.toMatch(/--workspace-concurrency\s+\d+\s+run\b/);
  });
});

describe("workspace packages the root build recurses over", () => {
  // P0.93 filed the same symptom with a different diagnosis: that only @ballista/app
  // defined a build script, so the recursive form had nothing to run. That diagnosis
  // was wrong — every one of them defines one — and this test pins it so the claim
  // cannot be re-filed from memory a fourth time.
  it("every workspace package defines a build script", () => {
    const missing = workspacePackages()
      .filter(({ pkg }) => pkg.scripts?.build === undefined)
      .map(({ dir }) => dir);
    expect(missing).toEqual([]);
  });

  // The count is pinned so that adding a package is a deliberate act that shows
  // up here, rather than something that drifts in unnoticed. Went 8 → 9 in
  // P7.07 with @ballista/wasm-core. Update the number when you add one; do not
  // relax the assertion.
  it("finds the nine packages the recursive build reports in scope", () => {
    expect(
      workspacePackages()
        .map(({ dir }) => dir)
        .sort(),
    ).toEqual([
      "analysis",
      "app",
      "engine",
      "runtime",
      "solverkit",
      "ui",
      "validation",
      "viz",
      "wasm-core",
    ]);
  });
});

// ---------------------------------------------------------------------------
// P0.110. The pre-push gate and ci.yml drifting apart.
//
// CLAUDE.md tells every session to run a gate before pushing to main, and the
// gate it named covered five of the twelve hard-failing steps ci.yml actually
// runs. A fully green local gate could therefore land red — which is what
// happened at a7f09b9, where an exported type inferred from an unexported const
// turned the typedoc steps red while typecheck, lint, lint:deps, test and build
// were all clean locally.
//
// The filing suggested pointing CLAUDE.md at a `pnpm verify` script instead of
// a prose list that drifts. That script already existed, and it had drifted the
// same way — `typecheck && lint && lint:deps && test`, four of the twelve. So a
// script alone is not the fix; nothing was checking either one against ci.yml.
// This is that check.
//
// It is a string assertion on two files rather than a run of the gate, for the
// same reason the P0.90 tests above are: the failure mode is a step added to CI
// and not to the gate, and that is exactly what comparing the two texts catches.
// Running the gate here would cost ~5 minutes and would not catch it at all.
//
// Soft-warn steps are deliberately NOT required. ci.yml marks them in the step
// name, and they measure timings on a shared runner where a noisy neighbour is
// not a defect — gating a push on them would train everyone to re-run until
// green. That exclusion is asserted too, so dropping the marker from a step name
// fails here rather than silently conscripting a benchmark into the gate.
const CI_WORKFLOW = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

interface CiStep {
  name: string;
  run: string;
}

/**
 * Steps in ci.yml that carry a `run:`, paired with the `name:` above them.
 *
 * Deliberately a line scanner rather than a YAML parse: @ballista/validation
 * declares no YAML dependency, and .dependency-cruiser.cjs would reject one
 * added for a test. Every `run:` in the file is single-line, which the
 * "no folded run blocks" assertion below pins so this stays true.
 */
function ciRunSteps(): CiStep[] {
  const steps: CiStep[] = [];
  let pendingName = "";
  for (const line of CI_WORKFLOW.split("\n")) {
    const name = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(line)?.[1];
    if (name !== undefined) {
      pendingName = name;
      continue;
    }
    const run = /^\s*-?\s*run:\s*(.+?)\s*$/.exec(line)?.[1];
    if (run !== undefined) {
      steps.push({ name: pendingName, run });
      pendingName = "";
    }
  }
  return steps;
}

/** Environment setup, not a check: these bring the runner up, they do not assert anything. */
const SETUP_RUNS = [
  "pnpm install --frozen-lockfile",
  "pnpm exec playwright install --with-deps chromium firefox",
];

const isSoftWarn = (step: CiStep): boolean => step.name.toLowerCase().includes("soft warn");

/**
 * ci.yml runs some steps in a form a local gate should not copy verbatim.
 * Each entry says what the gate runs instead, and why the difference is
 * deliberate — an unexplained difference is the drift this block exists to stop.
 */
const GATE_EQUIVALENTS: Record<string, { gate: string; because: string }> = {
  "pnpm bench:throughput | tee batch-throughput-ci.json.log": {
    gate: "",
    because: "soft warn; the tee target is a CI artifact path",
  },
  "pnpm --filter @ballista/engine run docs": {
    gate: "pnpm --filter=@ballista/engine run docs",
    because:
      "the = form, because the space form is what the P0.90 assertion above forbids in root scripts",
  },
  "pnpm --filter @ballista/solverkit run docs": {
    gate: "pnpm --filter=@ballista/solverkit run docs",
    because: "same as the engine docs step",
  },
  "pnpm --filter @ballista/app build": {
    gate: "pnpm --filter=@ballista/app build",
    because: "same as the engine docs step",
  },
  "pnpm --filter @ballista/app check-bundle-size": {
    gate: "pnpm --filter=@ballista/app check-bundle-size",
    because: "same as the engine docs step",
  },
};

/** What `pnpm verify` should run for a given ci.yml `run:`, or "" if it deliberately should not. */
function gateFormOf(run: string): string {
  return GATE_EQUIVALENTS[run]?.gate ?? run;
}

describe("the pre-push gate tracks ci.yml (P0.110)", () => {
  const verify = rootScripts.verify ?? "";
  const gateSteps = verify.split("&&").map((s) => s.trim());

  it("defines a verify script", () => {
    expect(
      verify,
      "root package.json must define the gate as a script, not as prose in CLAUDE.md",
    ).not.toEqual("");
  });

  it("parses every run step out of ci.yml", () => {
    // Guards the scanner itself. If this number moves, a step was added or
    // removed, and the assertions below are the ones that say whether the gate
    // needs to move with it.
    const steps = ciRunSteps();
    expect(steps.every((s) => s.run.length > 0)).toBe(true);

    // Asserted as the breakdown rather than a bare total, because the total
    // alone cannot say whether a new step needs to join the gate. 18 = 2 setup
    // + 12 hard + 4 soft warn. (The two upload-artifact steps carry `uses:`,
    // not `run:`, so they are not in this list at all.)
    expect({
      setup: steps.filter((s) => SETUP_RUNS.includes(s.run)).length,
      hard: steps.filter((s) => !isSoftWarn(s) && !SETUP_RUNS.includes(s.run)).length,
      softWarn: steps.filter(isSoftWarn).length,
    }).toEqual({ setup: 2, hard: 12, softWarn: 4 });
  });

  it("uses no folded or literal run blocks, which the line scanner could not read", () => {
    expect(CI_WORKFLOW).not.toMatch(/run:\s*[|>]/);
  });

  it("runs every hard-failing ci.yml step", () => {
    const missing = ciRunSteps()
      .filter((s) => !isSoftWarn(s) && !SETUP_RUNS.includes(s.run))
      .map((s) => ({ name: s.name, expected: gateFormOf(s.run) }))
      .filter(({ expected }) => expected !== "" && !gateSteps.includes(expected));
    expect(
      missing,
      "ci.yml gained a hard gate that `pnpm verify` does not run, so a green local gate can still land red",
    ).toEqual([]);
  });

  it("runs the hard-failing steps in ci.yml's own order", () => {
    // Order is part of the gate, not cosmetics: `pnpm test` on a fresh clone
    // needs packages/engine/dist, which `pnpm typecheck` emits as a side effect
    // of `tsc -b` over the composite projects. CI is green because Typecheck
    // precedes Test there. A gate that reordered them would fail for a reason
    // that reads like a broken measurement rather than a missing build.
    const expected = ciRunSteps()
      .filter((s) => !isSoftWarn(s) && !SETUP_RUNS.includes(s.run))
      .map((s) => gateFormOf(s.run))
      .filter((s) => s !== "");
    expect(gateSteps.filter((s) => expected.includes(s))).toEqual(expected);
  });

  it("does not conscript the soft-warn benchmarks into the gate", () => {
    const conscripted = ciRunSteps()
      .filter(isSoftWarn)
      .map((s) => s.run)
      .filter((run) => gateSteps.includes(run));
    expect(
      conscripted,
      "these measure timings on a shared machine; a push should not be gated on a noisy neighbour",
    ).toEqual([]);
  });

  it("does not run the runner setup steps, which a local checkout already has", () => {
    expect(gateSteps.filter((s) => SETUP_RUNS.includes(s))).toEqual([]);
  });
});
