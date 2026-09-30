// Realistic note text fixtures. The design asks for prose rather than repeated
// single characters, because text lays out the way real words do (line breaks,
// wide and narrow letters) and that is what the font auto-fit measures.

/** The PRD's golden-path idea. */
export const SHORT_PHRASE = 'Faster onboarding';

/** A retrospective item: three lines, about 120 characters. */
export const RETRO_ITEM =
  'What went well: we shipped the importer two days early,\n' +
  'What blocked us: the staging database was restored from a weekend backup,\n' +
  'Next: pair on the migration plan before anyone starts coding';

const SENTENCES: readonly string[] = [
  'The board remembers where every idea was placed, even when the room is busy.',
  'People can drop a note, type a thought and push it next to the ones it belongs to.',
  'Colour separates the themes without anyone having to write a heading first.',
  'A duplicate is gone with one key press, and nobody has to hunt for a menu.',
  'Long pasted text stays inside its note, so the layout never falls apart.',
  'Small teams review the wall together before they vote on what to build next.',
  'Nothing disappears when the connection drops, which is what makes it safe.',
];

/**
 * English prose of exactly `length` characters, built from whole sentences. The
 * last one may be cut mid-word, exactly like a real paste at a hard limit.
 */
export function prose(length: number): string {
  if (length <= 0) return '';
  let out = '';
  let index = 0;
  while (out.length < length) {
    out += (out.length === 0 ? '' : ' ') + SENTENCES[index % SENTENCES.length];
    index += 1;
  }
  return out.slice(0, length);
}

/** A full note of text: exactly the character limit. */
export const PROSE_1000 = prose(1000);
/** One character past the limit. */
export const PROSE_1001 = prose(1001);
/** A paste well past the limit: 1,200 characters. */
export const PROSE_1200 = prose(1200);
