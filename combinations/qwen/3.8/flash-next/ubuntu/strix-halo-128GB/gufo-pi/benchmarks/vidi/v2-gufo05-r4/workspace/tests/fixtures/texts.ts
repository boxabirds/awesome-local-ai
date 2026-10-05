/**
 * Realistic note texts for tests. Nothing here is a repeated single character:
 * sticky note text has to lay out the way a user's prose does, especially for
 * the font-fit and overflow assertions in e2e.
 */

/** A short idea, as typed in the golden path. */
export const SHORT_PHRASE = 'Faster onboarding';

/** A multi-line retrospective item (~120 characters, 3 lines). */
export const RETRO_ITEM =
  'Deploying on Fridays scared the team.\nWe added automated rollbacks.\nShip small, ship often, sleep well.';

const PROSE_SENTENCES = [
  'The retrospective started with a quiet room and a single yellow note in the middle of the board.',
  'Everyone wrote one thing that slowed them down this month, then moved it next to a similar idea.',
  'By lunch the notes had gathered into four loose clusters, each one a theme worth arguing about.',
  'Colour helped: orange for anything that needed a decision, green for things already going well.',
  'The longest note won a small prize, and the shortest one turned out to describe the real problem.',
  'Nobody agreed on everything, but everybody left with the same picture of where to start on Monday.'
];

/**
 * English prose of exactly `length` characters (default 1,000 — the sticky note
 * text limit), built from whole sentences so it wraps like real writing.
 */
export function proseOfLength(length = 1000): string {
  const full = PROSE_SENTENCES.join(' ');
  let text = '';
  while (text.length < length) {
    text += (text ? ' ' : '') + full;
  }
  return text.slice(0, length);
}

/** The 1,000 character fixture used by the text-limit tests. */
export const PROSE_1000 = proseOfLength(1000);
