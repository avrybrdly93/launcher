# Repository workflow policy

This repository does not use a pull-request review workflow. When completing
coding tasks here:

- Commit and push changes directly to `main`. Do not open a pull request and
  wait for human approval before landing work.
- Before pushing to `main`, run **`pnpm verify`**. That script _is_ the gate:
  it runs every step `.github/workflows/ci.yml` will fail a build on, in
  ci.yml's own order, so a green `pnpm verify` and a green CI mean the same
  thing. Roughly five minutes. CI still runs on every push to `main` as a
  backstop.

  Do not re-copy the step list into this file. It was a five-item list here
  and a four-step `verify` script for 43 runs while ci.yml grew to twelve
  hard-failing steps, and P6.01 landed red from a fully green local gate
  because of it (P0.110). `packages/validation/src/root-scripts.test.ts`
  now asserts that `verify` and ci.yml agree, so adding a CI step without
  adding it to `verify` turns the suite red instead of turning someone's
  push red.

  Four ci.yml steps are deliberately **not** in the gate — `bench:solverkit`,
  `bench:trend`, `bench:throughput` and `check:cross-engine-drift`. ci.yml
  marks each `(soft warn)` and does not gate on them: they measure timings on
  a shared machine, where a noisy neighbour is not a defect, and a push gate
  that fails for one trains everyone to re-run until it passes. Run them
  deliberately when you are working on performance. The runner-setup steps
  (`pnpm install`, `playwright install`) are also excluded — a local checkout
  already has both.

- Don't leave long-lived `claude/*` branches around after a task finishes.
  If you must work on a branch (e.g. to get CI signal before merging), merge
  it into `main` and delete it yourself once done rather than leaving it for
  someone else to close out.
