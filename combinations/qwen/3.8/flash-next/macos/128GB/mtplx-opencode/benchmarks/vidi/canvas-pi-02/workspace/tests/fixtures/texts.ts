/**
 * Realistic note text fixtures (design "Fixtures"). Long texts are built from
 * real English sentences rather than a repeated single character, which would
 * lay out unrealistically when measuring text fit.
 */

/** A short idea, as typed on a real sticky note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** One short word: fits at the largest note font size. */
export const ONE_WORD = 'Ideas';

/** A three-line retrospective item of about 120 characters. */
export const RETRO_ITEM = [
  'What worked: pairing on the migration landed early.',
  'What hurt: no way to hand a note to the next person.',
  'Try next: colour-code notes by owner.',
].join('\n');

const SENTENCES = [
  'The team kept the board small enough to read at a glance.',
  'Notes that belonged together were pushed into one column.',
  'Colour separated the owners, so nobody duplicated work.',
  'A duplicate note was deleted before it confused anyone.',
  'Long items were rewritten until they fitted the square.',
  'The retro ended with three themes and two owners.',
];

/**
 * Deterministic English prose of exactly `length` characters, built by
 * cycling through whole sentences and trimming the tail.
 */
export function prose(length: number): string {
  let text = '';
  let index = 0;
  while (text.length < length) {
    const sentence = SENTENCES[index % SENTENCES.length];
    text += `${index === 0 ? sentence : ` ${sentence}`}`;
    index += 1;
  }
  return text.slice(0, length);
}

/** Exactly STICKY_TEXT_MAX_CHARS characters of prose. */
export const LONG_PROSE = prose(1000);

/** 1,200 characters: the paste case that must be cut at the 1,000 limit. */
export const OVERLONG_PROSE = prose(1200);
