/**
 * Note text fixtures. Real English prose rather than repeated characters: text
 * that lays out unrealistically (one long word, or the same letter over and
 * over) hides both wrap bugs and font-fit bugs.
 */

import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/** A short idea, the kind that fits a note at the largest font size. */
export const SHORT_IDEA = 'Faster onboarding';

/** A multi-line retrospective item, about 120 characters over three lines. */
export const RETRO_ITEM =
  'Ship the demo weekly.\nOwners write the follow-ups down.\nWe stop restarting meetings that have no decisions.';

/**
 * ~1,400 characters of English prose, used as the source for the length
 * boundaries: {@link TEXT_1000} and {@link TEXT_1200} slice it to exact
 * lengths so a test can paste it and count on the result.
 */
export const LONG_PROSE = `Retro notes are small on purpose. A note that holds one idea can be moved, grouped and argued about on its own, which is what makes an affinity map work. When a note grows into a paragraph it stops being a card and becomes a document, and the group stops moving because nobody wants to drag a document around the board. So we write the shortest sentence that still means something, and we let colour carry the category instead of a heading. When the same complaint shows up three times we do not write a longer note, we put three notes next to each other and let the pile speak for itself. The next morning one of them disappears, because the person who wrote it talked to a colleague and changed their mind, and that is a good outcome: the board is thinking out loud rather than filing paperwork. Long prose belongs in the summary we publish afterwards, not here. The board is where the thinking happens, in front of everyone, at a size you can read from across the room, which is also why the text shrinks before it overflows and why the smallest size is still a size a person can read from their chair. Six colours are enough for a team that is trying to see structure, because colour is a cheap label and an expensive rule: anybody can add a note in the pink column without asking, and nobody has to remember which shade meant delivery and which meant people. When the pile on the right grows taller than the pile on the left, that is the conversation the team has next, and it is a conversation about the work, not about the tool.`;

/** Exactly 1,000 characters of prose: the note limit. */
export const TEXT_1000 = LONG_PROSE.slice(0, STICKY_TEXT_MAX_CHARS);

/** Exactly 1,200 characters of prose: longer than a note may keep. */
export const TEXT_1200 = LONG_PROSE.slice(0, STICKY_TEXT_MAX_CHARS + 200);

/** Exactly `length` characters taken from the prose (for boundary tests). */
export function proseOfLength(length: number): string {
  return LONG_PROSE.slice(0, length);
}
