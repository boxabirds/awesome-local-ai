/**
 * Realistic text fixtures for the sticky-note tests. English prose, never a
 * repeated single character (which lays out unrealistically and hides fit bugs).
 */

/** Short phrase used in the golden path. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Three-line retrospective item, ~120 characters. */
export const RETRO_ITEM =
  'What went well: shipped the beta.\nWhat did not: the queue kept filling.\n' +
  'Action: pair on the nightly backup before Friday.';

const PROSE_SENTENCES = [
  'The quick brown fox jumps over the lazy dog while the team reviews the board. ',
  'Retrospective notes are grouped into themes that surface blockers and wins. ',
  'Sticky colours separate topics, owners and votes so patterns become visible. ',
  'The facilitator moves related ideas together and removes the duplicates. ',
  'Long text must stay readable inside a small note without escaping its edges. ',
];

/** English prose grown to exactly 1,000 characters. */
export const PROSE_1000 = (() => {
  let text = '';
  let i = 0;
  while (text.length < 1000) {
    text += PROSE_SENTENCES[i % PROSE_SENTENCES.length];
    i += 1;
  }
  return text.slice(0, 1000);
})();
