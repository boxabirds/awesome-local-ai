/**
 * Realistic note text fixtures (shared by unit, component and e2e tests).
 * Long text is real English prose, not repeated characters, because text fit
 * depends on how the words actually lay out.
 */

export const SHORT_TEXT = 'Faster onboarding';

export const MULTI_LINE_TEXT = [
  'Went well: everyone brought a concrete example from their own project.',
  'To improve: the grouping round ran out of time before voting started.',
  'Action: split the board into per-team columns and timebox each round.',
].join('\n');

const SENTENCES = [
  'A sticky note is only useful when it can be read from across the room.',
  'During the retrospective the team wrote one idea per note and read them aloud.',
  'Grouping similar notes next to each other turned a messy hour into a clear plan.',
  'Colour told the room which theme a note belonged to without anybody speaking.',
  'Notes that were too long became unreadable, so shorter phrasing won every time.',
  'The facilitator moved the clusters apart as soon as two themes started to overlap.',
  'Duplicates were easy to spot once the notes were lined up in columns.',
  'By the end of the session each column had one owner and one next step written on it.',
  'Nobody argued about wording because the note in front of them was already concrete.',
  'A blank note left on the board was a reminder that somebody still owed an answer.',
  'When the room ran out of wall space the board simply kept going sideways.',
  'The follow up review started from the same board and the same colours.',
];

/** Real words that pad text to an exact character count (leading space included). */
const FILLER = ['', '.', ' a', ' we', ' now', ' idea', ' notes'];

/** English prose of exactly `target` characters. */
function prose(target: number): string {
  let text = '';
  for (const sentence of SENTENCES) {
    if (text.length + (text ? 1 : 0) + sentence.length > target) {
      continue;
    }
    text += (text ? ' ' : '') + sentence;
  }
  let remainder = target - text.length;
  while (remainder > FILLER.length - 1) {
    text += ' notes';
    remainder -= 6;
  }
  return text + (FILLER[remainder] ?? '');
}

export const LONG_TEXT_LENGTH = 1000;

/** Exactly 1,000 characters of prose (the note text limit). */
export const LONG_TEXT = prose(LONG_TEXT_LENGTH);

/** 1,200 characters of prose, i.e. past the limit. */
export const OVER_LONG_TEXT = prose(1200);

if (LONG_TEXT.length !== LONG_TEXT_LENGTH) {
  throw new Error(`fixture LONG_TEXT must be exactly ${LONG_TEXT_LENGTH} characters`);
}
