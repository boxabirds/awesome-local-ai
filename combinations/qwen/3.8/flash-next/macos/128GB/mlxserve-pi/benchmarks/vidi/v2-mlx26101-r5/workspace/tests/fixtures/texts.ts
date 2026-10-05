/**
 * Realistic note texts used by the unit, component and e2e tests.
 *
 * The long fixture is English prose (not a repeat of one character), so it wraps
 * the way real note text wraps when the auto-fit measures it.
 */

/** Short note from the PRD's golden path. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retrospective item: 3 lines, ~180 characters. */
export const RETRO_ITEM = [
  'Keep the weekly demo to ten minutes and end with one decision we all own.',
  'Ask everyone for the smallest thing that would have helped them this week.',
  'Write the follow-up owner next to the item before we leave the call.',
].join('\n');

const PROSE_SENTENCE =
  'The team sketched the flow on the board, moved the ideas into groups and agreed on the next step. ';

/** Exactly 1,000 characters of English prose (the text length limit fixture). */
export const LONG_PROSE_1000 = PROSE_SENTENCE.repeat(
  Math.ceil(1000 / PROSE_SENTENCE.length),
).slice(0, 1000);

/** 1,200 characters: a paste that is 200 characters over the limit. */
export const LONG_PROSE_1200 = `${LONG_PROSE_1000}${' and one more sentence that does not fit at all. '.repeat(
  5,
).slice(0, 200)}`;
