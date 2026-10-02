/**
 * Note text fixtures used by the component and E2E tests.
 *
 * The long fixture is English prose rather than a repeated character: a run of
 * identical glyphs lays out unrealistically (no word breaks, uniform width), so
 * it would not exercise the auto-fit search the way real text does.
 */
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/** A short idea, as typed in the golden path. */
export const SHORT_PHRASE = 'Faster onboarding';

/** A three-line retrospective item, about 120 characters. */
export const RETRO_ITEM =
  'What went well:\n- shipped the board on time\n- pairing unblocked the stuck ticket';

const SENTENCES = [
  'Faster onboarding for the teams that join us every single week.',
  'Keep the retro short so that people keep coming back to it.',
  'Notes should group themselves by colour instead of by folder.',
  'The board felt slow while nobody was looking at the cursor.',
  'Let everyone move ideas next to related ones without asking.',
  'Two people editing one note at the same time confused the tool.',
  'Bring back the timer, but only for the voting round please.',
  'Delete the duplicates as soon as the second one appears.',
];

/**
 * English prose of exactly `chars` characters (the last word may be cut, which
 * is what a real paste pasted into a limited note looks like).
 */
export function prose(chars: number): string {
  if (chars <= 0) return '';
  let text = '';
  for (let i = 0; text.length < chars; i += 1) {
    text += `${text.length === 0 ? '' : ' '}${SENTENCES[i % SENTENCES.length]}`;
  }
  return text.slice(0, chars);
}

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of prose — fills a note. */
export const PROSE_AT_LIMIT = prose(STICKY_TEXT_MAX_CHARS);

/** 200 characters past the limit — only the first 1,000 survive. */
export const PROSE_OVER_LIMIT = prose(STICKY_TEXT_MAX_CHARS + 200);

/** One character fewer than the limit, plus one more to reach it. */
export const PROSE_JUST_UNDER = prose(STICKY_TEXT_MAX_CHARS - 1);
