/**
 * `Stepper.info.id` -> its co-located derivation page (P2.51: "each stepper
 * links its derivation"; `*.derivation.md`, wired into TypeDoc via
 * `projectDocuments` in `typedoc.json`). A single, exported lookup rather
 * than each consumer re-deriving a filename from an id -- P3.24's advisor
 * hints (`recommendSolver`, `@ballista/engine`) is the first runtime
 * consumer, linking a hint's recommended stepper straight to the page that
 * derives it.
 *
 * `docs-derivation-links.test.ts` asserts each `*.ts` file actually links
 * its own `.derivation.md` (P2.51's own validation criterion); this
 * module's test asserts every entry *here* points at one of those same
 * files, so the two can't silently drift apart.
 */
export const STEPPER_DERIVATION_DOCS: Readonly<Record<string, string>> = {
  "explicit-euler": "explicit-euler-stepper.derivation.md",
  "semi-implicit-euler": "semi-implicit-euler-stepper.derivation.md",
  "heun-rk2": "heun-rk2-stepper.derivation.md",
  "midpoint-rk2": "midpoint-rk2-stepper.derivation.md",
  "classical-rk4": "classical-rk4-stepper.derivation.md",
  "bogacki-shampine-32": "bogacki-shampine-32.derivation.md",
  dopri5: "dormand-prince-54.derivation.md",
  "velocity-verlet": "verlet-stepper.derivation.md",
  "position-verlet": "verlet-stepper.derivation.md",
  "backward-euler": "backward-euler-stepper.derivation.md",
};

/** The derivation page filename for `stepperId`, or `undefined` for an id with no known page. */
export function stepperDerivationDoc(stepperId: string): string | undefined {
  return STEPPER_DERIVATION_DOCS[stepperId];
}
