/**
 * Note text fixtures (design "Fixtures"): realistic English prose, never repeated single
 * characters, which would lay out unrealistically when the font auto-fit is verified.
 */

/** Short note (TC-33 first half: the note shows the largest font size). */
export const SHORT_NOTE = 'Faster onboarding';

/** A multi-line retrospective item: three lines, ~120 characters. */
export const RETRO_ITEM =
  'What went well: the release train kept its pace\n' +
  'What hurt: hand-offs between design and QA\n' +
  'Next: one shared checklist per sprint';

const PROSE_SENTENCES = [
  'The team gathered around the board to map out what the last quarter had taught them.',
  'Ideas went down as they came, one note per thought, and nobody judged them yet.',
  'Slowly, related notes drifted together into columns that named the real themes.',
  'Colour separated the themes from the risks, and the risks from the open questions.',
  'When someone moved a note beside another one, the conversation changed direction.',
  'By the end of the hour the wall had become a map of the next quarter of work.',
  'Nobody had fought the tool, which is the only real measure of a whiteboard.',
];

/** Build exactly `length` characters of English prose (the last sentence is cut short). */
function buildProse(length: number): string {
  let text = '';
  let index = 0;
  while (text.length < length) {
    const sentence = PROSE_SENTENCES[index % PROSE_SENTENCES.length];
    text += text.length === 0 ? sentence : ` ${sentence}`;
    index += 1;
  }
  return text.slice(0, length);
}

/** Exactly 1,000 characters of prose (the sticky note text limit). */
export const PROSE_1000 = buildProse(1000);

/** 1,200 characters of prose: pasting this into a note keeps exactly the first 1,000. */
export const PROSE_1200 = buildProse(1200);
