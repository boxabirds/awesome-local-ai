/**
 * Note text fixtures used by the unit, component and e2e suites.
 *
 * The long fixture is real English prose: repeated single characters lay out
 * very differently from words (no line breaks, no spaces), so they would make
 * the auto-fit tests pass for the wrong reason.
 */
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/** A short idea, the kind a brainstorm note usually holds. */
export const SHORT_NOTE = 'Faster onboarding';

/** A three-line retrospective item, about 120 characters. */
export const RETRO_NOTE =
  'Deployments took all afternoon\nwe still wait on manual approval\npair the release owner with a backup';

/**
 * Long-form prose (well over the text limit); `PROSE_LIMIT` is exactly
 * STICKY_TEXT_MAX_CHARS characters of it.
 */
const PROSE =
  'The team met on a rainy Tuesday to work through the onboarding funnel, and the ' +
  'first thing they wrote down was that new hires spend their opening week asking ' +
  'the same five questions. Some of those questions were about tooling, some about ' +
  'who to approach when a build breaks, and one was quietly about where to find a ' +
  'coffee that was not terrible. They grouped the notes into themes, argued for a ' +
  'while about whether the themes belonged to the product or to the process, and ' +
  'then discovered that the distinction did not matter much once the colours were ' +
  'on the board. A junior engineer moved a lonely yellow square next to a cluster ' +
  'of green ones, and everyone agreed that this was the cheapest meeting of the ' +
  'quarter. By lunch they had a plan: write the answers down, record a short walkthrough, ' +
  'give every new hire a buddy for the first fortnight, and fix the coffee. None of ' +
  'it required a new tool, which felt like a small victory, and the facilitator ' +
  'promised to keep the board open so the notes could keep moving for a week. '
+
  'When the retro came around again they found three notes they had forgotten, one '
+
  'of which had turned out to be the simplest fix of all, and they laughed about '
+
  'how long a small square of paper can wait before anybody reads it.';

/** Exactly the maximum note length, taken from the prose above. */
export const PROSE_LIMIT = PROSE.slice(0, STICKY_TEXT_MAX_CHARS);

/** One character past the limit, for the rejection boundary. */
export const PROSE_OVER_LIMIT = PROSE.slice(0, STICKY_TEXT_MAX_CHARS + 1);

/** Far past the limit: the paste case from the PRD (1,200 characters). */
export const PROSE_PASTE = PROSE.slice(0, 1200);

/** A single word, the smallest possible content. */
export const ONE_WORD = 'Onboarding';
