/**
 * Realistic note text fixtures (design "Fixtures"): a short phrase, a
 * multi-line retrospective item and a 1,000 character English paragraph.
 *
 * The long fixture is prose, not a repeated single character: repeated
 * characters lay out unrealistically (no spaces, so no line breaks), which is
 * exactly what the text-fit tests depend on.
 */

/** The PRD's golden-path note. */
export const SHORT_TEXT = 'Faster onboarding';

/** A three-line retrospective item (~120 characters). */
export const RETRO_ITEM =
  'What went well: we shipped the beta two days early,\n' +
  'documentation landed with the code instead of after it,\n' +
  'and the on-call rotation stayed quiet all sprint.';

const SENTENCES = [
  'The team agreed that the first draft of the onboarding guide was too long to read in one sitting.',
  'We shortened each step to a single sentence and moved the screenshots into an appendix.',
  'Newcomers finished their first task in under twenty minutes, which nobody had managed before.',
  'The retro board filled up with sticky notes before the meeting even started.',
] as const;

/** Build exactly `length` characters of prose (deterministic, ASCII only). */
function prose(length: number): string {
  let text = '';
  for (let i = 0; text.length < length; i += 1) {
    const sentence = SENTENCES[i % SENTENCES.length] ?? '';
    text += text.length === 0 ? sentence : ` ${sentence}`;
  }
  return text.slice(0, length);
}

/** A 1,000 character paragraph: the longest text a note may hold. */
export const PROSE_1000 = prose(1000);

/**
 * A 300 character annotation (design "Fixtures"): the longest sentence a person is
 * likely to type into a text object without meaning to. It is long enough that no
 * text object can hold it on one automatic line - the box reaches
 * TEXT_MAX_AUTO_WIDTH_WORLD and the words go over into several lines - and it is
 * prose with spaces in it, so where the lines break is the browser's business and
 * not an artefact of a repeated character.
 */
export const ANNOTATION_300 = prose(300);

/** 1,050 characters: more than the limit, so pasting it must be clamped. */
export const PROSE_1050 = prose(1050);

/** 1,200 characters: the PRD's "paste 1,200 characters" verification. */
export const PROSE_1200 = prose(1200);

/** A single character to append when testing the exact limit boundary. */
export const ONE_MORE_CHAR = '!';
