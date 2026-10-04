import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/**
 * Realistic note text fixtures.
 *
 * The long fixture is a paragraph of English prose (not one repeated character,
 * which lays out unrealistically) cut to exactly STICKY_TEXT_MAX_CHARS.
 */

/** Short note (PRD golden path). */
export const SHORT_NOTE = 'Faster onboarding';

/** Multi-line retrospective item: 3 lines, about 120 characters. */
export const RETRO_ITEM =
  'What went well: shipped the board in one sprint.\n' +
  'What did not: nobody knew the shortcut for zoom.\n' +
  'Next: add a hint that shows the keyboard shortcuts on first visit.';

const PARAGRAPH_SEED =
  'The team agreed that onboarding needs a clearer first run, with a short guide, ' +
  'one example board and a checklist that every new member can follow without ' +
  'asking a colleague for help. We also want the welcome note to explain that ' +
  'any idea can be dropped anywhere on the board and moved later, because the ' +
  'shape of a discussion changes as more people join and start adding their own ' +
  'thoughts to the wall. ';

function buildParagraph(length: number): string {
  let out = '';
  while (out.length < length) out += PARAGRAPH_SEED;
  const cut = out.slice(0, length);
  const lastSpace = cut.lastIndexOf(' ');
  const tail = PARAGRAPH_SEED.slice(0, length - lastSpace - 1);
  return `${cut.slice(0, lastSpace + 1)}${tail}`;
}

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of English prose. */
export const LONG_NOTE_1000 = buildParagraph(STICKY_TEXT_MAX_CHARS);

/** 1,200 characters — a paste that is 200 characters over the limit. */
export const PASTE_1200 = buildParagraph(STICKY_TEXT_MAX_CHARS + 200);

/** A single word, used to check the maximum font size. */
export const ONE_WORD = 'Onboarding';
