/**
 * P6.30's dashboard help: the estimator when-to-use table, rendered where the
 * question is actually asked.
 *
 * The dashboard runs plain Monte Carlo and nothing else. Four other methods
 * exist in the repository, are tested, and are wired into nothing — and a
 * reader has no way to tell whether that is because they are unfinished,
 * inappropriate here, or merely unwired. ADR-019 answers that; this panel is
 * the link to it, and enough of the table inline that a reader who does not
 * follow the link still learns which method matches which question.
 *
 * **Every word here comes from `ESTIMATOR_GLOSSARY`.** Nothing is retyped.
 * That is the whole design: `estimator-glossary.test.ts` checks those rows
 * against the modules and validation tests they describe, so a rename or a
 * moved module fails there rather than leaving stale advice on screen. A copy
 * of the prose in this file would be outside that guard and would rot silently
 * — which is precisely the failure ADR-019 exists to prevent, so reproducing
 * it in the panel that advertises the ADR would be a poor joke.
 *
 * Collapsed by default, as a `<details>` rather than a bespoke disclosure. The
 * native element is keyboard-operable and announces its own expanded state
 * without any of that being this module's problem, and help nobody asked for
 * should not push the dashboard's four result sections down the page.
 */

import { ESTIMATOR_GLOSSARY, ESTIMATOR_GLOSSARY_ADR } from "@ballista/analysis";

export interface EstimatorHelpPanelProps {
  /**
   * Where the ADR is served from, relative to the page. Defaults to the
   * repository-relative path the glossary publishes, which is what a reader
   * browsing the source tree wants; a deployment serving docs elsewhere passes
   * its own prefix rather than this module guessing one.
   */
  readonly docHref?: string;
}

export function EstimatorHelpPanel({
  docHref = `../../${ESTIMATOR_GLOSSARY_ADR}`,
}: EstimatorHelpPanelProps) {
  return (
    <details class="estimator-help" data-testid="estimator-help">
      <summary data-testid="estimator-help-summary">
        Which estimator should I be using? ({ESTIMATOR_GLOSSARY.length} methods)
      </summary>

      <p class="estimator-help__caption">
        This dashboard runs plain Monte Carlo. The other four are implemented and tested but are not
        wired into it &mdash; the table says which of them would help with which question, and which
        would buy nothing. Full reasoning, with the measurements behind each row, is in ADR-019.
      </p>

      <ul class="estimator-help__list">
        {ESTIMATOR_GLOSSARY.map((entry) => (
          <li
            class="estimator-help__entry"
            key={entry.id}
            data-testid={`estimator-help-${entry.id}`}
          >
            <h4 class="estimator-help__name">
              {entry.name} <span class="estimator-help__abbr">({entry.abbreviation})</span>
            </h4>
            <dl class="estimator-help__fields">
              <dt>Estimates</dt>
              <dd data-testid={`estimator-help-${entry.id}-estimates`}>{entry.estimates}</dd>
              <dt>Error behaviour</dt>
              <dd>{entry.errorBehaviour}</dd>
              <dt>Reach for it when</dt>
              <dd data-testid={`estimator-help-${entry.id}-use`}>{entry.useWhen}</dd>
              <dt>Do not, when</dt>
              <dd data-testid={`estimator-help-${entry.id}-avoid`}>{entry.avoidWhen}</dd>
              <dt>Implemented in</dt>
              <dd>
                <code>{entry.module}</code> &mdash; <code>{entry.entryPoint}</code> ({entry.task})
              </dd>
            </dl>
          </li>
        ))}
      </ul>

      <p class="estimator-help__adr-link">
        <a data-testid="estimator-help-adr-link" href={docHref}>
          ADR-019 &mdash; estimator glossary and when-to-use table
        </a>
      </p>
    </details>
  );
}
