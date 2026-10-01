/** Realistic note text fixtures (not repeated single characters). */

export const SHORT_PHRASE = 'Faster onboarding';

/** A three-line retrospective item, ~120 characters. */
export const RETRO_ITEM =
  'What went well: shipped the editor beta two days early.\n' +
  'What to improve: review turnaround took a full week.\n' +
  'Action: pair junior reviewers with seniors on every PR.';

const PROSE_SENTENCES = [
  'The team gathered around the whiteboard to map out the quarter ahead.',
  'Sticky notes in bright colours covered every free inch of the wall.',
  'Each idea was written in marker large enough to read from the doorway.',
  'Related notes drifted together into clusters as the discussion evolved.',
  'Someone grouped three yellow notes under a heading called follow up.',
  'A violet note near the corner held a question nobody could answer yet.',
  'The facilitator counted the votes and circled the top three themes.',
  'Colour became a quiet language for ownership across the whole room.',
];

function buildParagraph(target: number): string {
  let text = '';
  let i = 0;
  while (text.length < target) {
    const sentence = PROSE_SENTENCES[i % PROSE_SENTENCES.length];
    text += text.length === 0 ? sentence : ` ${sentence}`;
    i += 1;
  }
  return text.slice(0, target);
}

/** An English paragraph of exactly STICKY_TEXT_MAX_CHARS (1,000) characters. */
export const LONG_PARAGRAPH_1000 = buildParagraph(1000);

/** An English paragraph of exactly 1,200 characters (over the note limit). */
export const PASTE_1200 = buildParagraph(1200);
