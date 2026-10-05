/**
 * Realistic note texts.
 *
 * The design asks for English prose rather than repeated single characters:
 * a run of one letter lays out unrealistically narrow, which would let a font
 * size through the auto-fit that no real note would ever get.
 */

import { TEXT_SIZES } from '../../src/shared/config';
import type { TextSize } from '../../src/shared/config';
import type { TextMeasurer } from '../../src/client/objects/textLayout';

/** A short idea, the kind a brainstorm starts with. */
export const SHORT_NOTE = 'Faster onboarding';

/** Short headings, of the kind a retrospective board is divided with. */
export const HEADING_WENT_WELL = 'Went well';

/** The other half of the same pair. */
export const HEADING_TO_IMPROVE = 'To improve';

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
/** Prose of exactly `length` characters. */
function buildProse(length: number): string {
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
export const LONG_NOTE: string = buildProse(1000);

/** 1,200 characters: what a paste is cut down from (TC-14, TC-33). */
export const TOO_LONG_NOTE: string = buildProse(1200);

/**
 * A 300-character annotation: long enough that its longest line is wider than the widest box text is
 * allowed, so typing it is what proves a box stops growing and starts wrapping (TC-26).
 */
export const LONG_ANNOTATION: string = buildProse(300);

/** Exactly TEXT_MAX_CHARS (5,000) characters: the most the board holds. */
export const TEXT_AT_LIMIT: string = buildProse(5000);

/** 5,001 characters: one more than the board accepts, which is what a paste is cut down from (TC-05). */
export const TOO_LONG_TEXT: string = buildProse(5001);

if (
  LONG_NOTE.length !== 1000 ||
  TOO_LONG_NOTE.length !== 1200 ||
  LONG_ANNOTATION.length !== 300 ||
  TEXT_AT_LIMIT.length !== 5000 ||
  TOO_LONG_TEXT.length !== 5001
) {
  throw new Error(
    'text fixtures are the wrong length: ' +
      `LONG_NOTE=${LONG_NOTE.length}, ` +
      `TOO_LONG_NOTE=${TOO_LONG_NOTE.length}, ` +
      `LONG_ANNOTATION=${LONG_ANNOTATION.length}, ` +
      `TEXT_AT_LIMIT=${TEXT_AT_LIMIT.length}, ` +
      `TOO_LONG_TEXT=${TOO_LONG_TEXT.length}`,
  );
}

/* ---------------------------------------------------------------- layout -- */

/**
 * A text measurer that needs no canvas and no font.
 *
 * A real measurement depends on which font the machine has, which is exactly why the layout tests cannot
 * use one: "this line is the widest the box allows" has to mean the same thing on a laptop, on CI and in
 * five years' time, and the whole point of those tests is the arithmetic around a measurement — where the
 * greedy algorithm breaks a line, how wide the box comes out, how many lines tall it is. So the fake
 * measures every character as half the font size, which is roughly what the estimate does anyway, and makes
 * a line's width a thing a test can state in characters: a line of 60 characters at size M is 600 units wide
 * and that is the boundary, on every machine.
 */
export function fakeMeasurer(): TextMeasurer {
  return (line: string, size: TextSize) => ({
    width: line.length * TEXT_SIZES[size] * 0.5,
    height: TEXT_SIZES[size],
  });
}

/**
 * A word of exactly `characters` letters.
 *
 * Layout assertions are about widths, and a width is a number of characters times a font size; prose of a
 * length that is not a round number would make every expected value in the test an expression nobody can
 * check by eye. The realistic prose above is what the component and end-to-end tests type, where the
 * assertion is about behaviour rather than about millimetres.
 */
export function word(characters: number): string {
  return 'w'.repeat(characters);
}

/**
 * Two words that together measure exactly 900 world units at size M: wider than the widest box the board
 * allows, so laying it out is what proves a box stops growing and starts wrapping.
 */
export const LINE_WIDER_THAN_THE_CAP = `${word(44)} ${word(45)}`;

/**
 * Two words that together measure exactly 600 world units at size M: the widest a line may be, and the
 * boundary — a line this wide is one line, not an overflow.
 */
export const LINE_AT_THE_CAP = `${word(29)} ${word(30)}`;

if (
  LINE_WIDER_THAN_THE_CAP.length !== 90 ||
  LINE_AT_THE_CAP.length !== 60 ||
  fakeMeasurer()(LINE_WIDER_THAN_THE_CAP, 'M').width !== 900 ||
  fakeMeasurer()(LINE_AT_THE_CAP, 'M').width !== 600
) {
  throw new Error(
    `layout fixtures are the wrong width: ${LINE_WIDER_THAN_THE_CAP.length}, ${LINE_AT_THE_CAP.length}`,
  );
}

