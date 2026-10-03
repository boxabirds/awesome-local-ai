// Realistic text fixtures for sticky note tests. We deliberately use English
// prose (never a repeated single character) so text lays out and wraps the way
// it would for a real user.

/** A short note, as the golden path uses. */
export const SHORT_PHRASE = 'Faster onboarding';

/** A multi-line retrospective item (~120 chars across three lines). */
export const RETRO_ITEM =
  'What went well this sprint:\n- Shipped the infinite board a full day early\n- Communication stayed clear and pairing covered the hard parts';

const PARAGRAPH_SENTENCES = [
  'The team gathered to map out the onboarding journey from first click. ',
  'Each person wrote one idea per note and placed it under a theme. ',
  'Similar notes were grouped together so patterns became obvious. ',
  'The facilitator asked clarifying questions as the board filled up. ',
  'By the end there were clear clusters around speed and clarity. ',
  'A few stray notes about billing were moved to a separate column. ',
];

/**
 * An English paragraph of exactly 1,000 characters (built from varied prose, not
 * a single repeated character) used to exercise the character limit and the text
 * auto-fit at its smallest size.
 */
export const THOUSAND_CHARS: string = (() => {
  let s = '';
  while (s.length < 1000) s += PARAGRAPH_SENTENCES.join('');
  return s.slice(0, 1000);
})();

/** A 1,200 character paste used to prove characters beyond the limit are dropped. */
export const TWELVE_HUNDRED_CHARS: string = (() => {
  let s = '';
  while (s.length < 1200) s += PARAGRAPH_SENTENCES.join('');
  return s.slice(0, 1200);
})();

/**
 * Everyday retrospective words. The seeded random-op generators type real words
 * (never a repeated character) so generated boards look like real ones.
 */
export const RANDOM_WORDS: readonly string[] = [
  'onboarding',
  'handoff',
  'clarify',
  'cluster',
  'facilitator',
  'retrospective',
  'timescale',
  'action',
  'blocker',
  'appreciation',
  'pricing',
  'documentation',
  'pairing',
  'release',
  'backlog',
  'follow-up',
  'template',
  'agenda',
  'timebox',
  'vote',
];
