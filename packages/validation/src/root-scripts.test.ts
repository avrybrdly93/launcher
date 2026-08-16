// P0.90 regression guard: the root `pnpm build` script must actually run.
//
// Why this file exists at all. `package.json`'s root build script was
// `pnpm -r --workspace-concurrency 1 run build`. Under the pnpm version this repo
// pins itself (`packageManager: pnpm@11.9.0`) that exits 1 with
// ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT — pnpm reads the space-separated flag value as
// consuming the next token, so `run` becomes the script name and it goes looking
// for a "run" script in eight packages that do not have one. The `=` form
// (`--workspace-concurrency=1`) parses correctly and builds all eight.
//
// The fix is one character. It took the repo eleven changelog entries and three
// duplicate task filings (P0.90, P0.93, P1.01) to land, because nothing failed
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
  // was wrong — all eight define one — and this test pins it so the claim cannot be
  // re-filed from memory a fourth time.
  it("every workspace package defines a build script", () => {
    const missing = workspacePackages()
      .filter(({ pkg }) => pkg.scripts?.build === undefined)
      .map(({ dir }) => dir);
    expect(missing).toEqual([]);
  });

  it("finds the eight packages the recursive build reports in scope", () => {
    expect(workspacePackages()).toHaveLength(8);
  });
});
