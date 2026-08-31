# Repository workflow policy

This repository does not use a pull-request review workflow. When completing
coding tasks here:

- Commit and push changes directly to `main`. Do not open a pull request and
  wait for human approval before landing work.
- Before pushing to `main`, run **`pnpm verify`** so broken code doesn't land
  un-vetted. CI still runs on every push to `main` as a backstop.

  `pnpm verify` is the gate. It runs every step `.github/workflows/ci.yml`
  runs, in CI's order, so a green local run means the same thing CI's green
  means. **Do not reproduce the step list here** — this bullet used to name
  four commands out of eleven, and a session that ran all four and pushed
  could still land red, which is what P0.110 was filed for. The list lives in
  `package.json`'s `verify` script, and
  `packages/validation/src/pre-push-gate.test.ts` fails if `ci.yml` ever grows
  a step the script does not run.

  Two of CI's steps are deliberately **not** in the gate, because they
  provision the environment rather than check the tree:
  `pnpm install --frozen-lockfile` (you already have a node_modules) and
  `pnpm exec playwright install` (browsers are installed once, not per push).
  That test knows about both and will tell you if a third omission appears.

  One difference from CI on purpose: the gate runs
  `pnpm check:cross-engine-drift` **without** `--record`, so it measures and
  reports but writes nothing. `ci.yml`'s own comment on that step asks for
  exactly this. Refreshing `scripts/cross-engine-drift-results.json` stays a
  deliberate act — run with `--record` yourself and commit the result.

- Don't leave long-lived `claude/*` branches around after a task finishes.
  If you must work on a branch (e.g. to get CI signal before merging), merge
  it into `main` and delete it yourself once done rather than leaving it for
  someone else to close out.
