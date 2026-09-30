/** Realistic note text fixtures (shared by unit, component and e2e tests). */

export const SHORT_NOTE = 'Faster onboarding';

/** Three-line retrospective item, ~120 characters. */
export const RETRO_NOTE =
  'What went well: shipped the beta on time.\n' +
  'What did not: the import tool kept timing out.\n' +
  'Next: assign an owner for the migration runbook.';

const PROSE_SENTENCES = [
  'Teams use sticky notes to capture one idea per note during a brainstorm.',
  'After the silent writing round, everybody places their notes on the board.',
  'Related ideas are grouped together so themes become visible at a glance.',
  'Colour helps separate owners, topics and vote counts without extra labels.',
  'A duplicate note is removed as soon as the group agrees it adds nothing.',
  'Long sentences must stay readable inside a small square of paper or pixels.',
  'The facilitator keeps the momentum by asking each person to explain a note.',
  'At the end the group votes on the themes they want to act on first.',
];

const FILLER_WORDS = ['notes', 'ideas', 'themes', 'votes', 'retro', 'team'];

/**
 * English prose of exactly `length` characters (default 1,000), built from real
 * sentences rather than a repeated single character, which lays out unrealistically.
 */
export function proseOfLength(length: number): string {
  let out = '';
  let i = 0;
  while (out.length < length) {
    out += (out ? ' ' : '') + PROSE_SENTENCES[i % PROSE_SENTENCES.length];
    i++;
  }
  // Cut back to the last word boundary, then top up with filler words.
  let text = out.slice(0, length);
  const lastSpace = text.lastIndexOf(' ');
  if (lastSpace > 0) text = text.slice(0, lastSpace);

  let gap = length - text.length;
  while (gap >= 2) {
    const word = FILLER_WORDS.find((w) => w.length + 1 === gap);
    if (word) {
      text += ' ' + word;
      gap = 0;
      break;
    }
    const longest = [...FILLER_WORDS]
      .sort((a, b) => b.length - a.length)
      .find((w) => w.length + 1 <= gap);
    if (!longest) break;
    text += ' ' + longest;
    gap = length - text.length;
  }
  // Any residue (0 or 1 characters) is padded with spaces.
  return (text + ' '.repeat(Math.max(0, length - text.length))).slice(0, length);
}

export const LONG_NOTE_1000 = proseOfLength(1000);
export const OVER_LIMIT_1200 = proseOfLength(1200);
