/**
 * Sticky note text fixtures, shared by the unit and e2e suites.
 *
 * The design asks for realistic English text: repeated single characters lay
 * out unrealistically, so the long fixture is a paragraph of prose cut to
 * exactly STICKY_TEXT_MAX_CHARS characters.
 */

/** Short phrase (PRD golden path). */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item: three lines, ~120 characters. */
export const RETRO_ITEM =
  'What went well: the release train kept its\n' +
  'schedule all quarter, and the new onboarding\n' +
  'flow cut setup time from days to an hour.';

import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

const PARAGRAPH_SENTENCES = [
  'The team gathered around the board to capture every idea from the last quarter',
  'Sticky notes in six colours helped separate themes owners and open questions',
  'Long paragraphs shrink to fit the note but never spill past its bottom edge',
  'Dragging an idea next to a related one is how affinity mapping starts',
  'A duplicate note is gone with a single press of the delete key',
  'Double-clicking empty space turns a thought into a note before it escapes',
];

function buildProse(target: number): string {
  let text = '';
  let index = 0;
  while (text.length < target) {
    const sentence = PARAGRAPH_SENTENCES[index % PARAGRAPH_SENTENCES.length];
    text += `${index === 0 ? '' : ' '}${sentence}.`;
    index += 1;
  }
  return text;
}

/** Exactly STICKY_TEXT_MAX_CHARS characters of English prose. */
export const PROSE_1000: string = buildProse(STICKY_TEXT_MAX_CHARS).slice(0, STICKY_TEXT_MAX_CHARS);

/** 1,200 characters: what gets pasted in the paste-limit checks. */
export const PROSE_1200: string = buildProse(1200).slice(0, 1200);

/**
 * Exactly 300 characters of the same prose: the PRD's "300-character sentence"
 * annotation, which is long enough that no free text on the board keeps it on one
 * line, and short enough to read out loud when a test fails (`text.auto_width`).
 */
export const PROSE_300: string = buildProse(300).slice(0, 300);
