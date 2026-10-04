/**
 * Realistic note texts.
 *
 * The design asks for English prose rather than repeated single characters:
 * a run of one letter lays out unrealistically narrow, which would let a font
 * size through the auto-fit that no real note would ever get.
 */

/** A short idea, the kind a brainstorm starts with. */
export const SHORT_NOTE = 'Faster onboarding';

/** A multi-line retrospective item (three lines, ~120 characters). */
export const RETRO_NOTE =
  'What went well: the release train held\nWhat hurt: review queues grew on Monday\nNext time: pair on the first review of the day';

const SENTENCES = [
  'The team agreed that the board should feel as quick as a sheet of paper.',
  'Notes were moved into groups by theme before anybody said a word about it.',
  'Colour carried the categories, so the labels could stay short and plain.',
  'A duplicate note was selected and deleted without a second thought.',
  'Long text shrank until it fitted, and then the note faded at the bottom.',
  'Nothing on the board was allowed to spill outside the note it belonged to.',
];

/**
 * Prose of exactly `length` characters. Sentences are joined until the text is
 * long enough and then cut at exactly `length`, so the fixture states its own
 * length instead of trusting a hand-counted string.
 */
function buildLongNote(length: number): string {
  let text = '';
  let index = 0;
  while (text.length < length) {
    const sentence = SENTENCES[index % SENTENCES.length]!;
    text = text.length === 0 ? sentence : `${text} ${sentence}`;
    index += 1;
  }
  return text.slice(0, length);
}

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of English prose. */
export const LONG_NOTE: string = buildLongNote(1000);

/** 1,200 characters: what a paste is cut down from (TC-14, TC-33). */
export const TOO_LONG_NOTE: string = buildLongNote(1200);

if (LONG_NOTE.length !== 1000 || TOO_LONG_NOTE.length !== 1200) {
  throw new Error(
    `text fixtures are the wrong length: LONG_NOTE=${LONG_NOTE.length}, TOO_LONG_NOTE=${TOO_LONG_NOTE.length}`,
  );
}
