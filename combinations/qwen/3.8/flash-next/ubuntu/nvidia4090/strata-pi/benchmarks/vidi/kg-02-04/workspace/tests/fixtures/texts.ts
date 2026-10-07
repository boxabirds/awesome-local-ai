/**
 * Realistic note text fixtures.
 *
 * The design asks for real English prose rather than repeated characters:
 * repeated characters lay out unrealistically, which is exactly what the text
 * fit and overflow measurements depend on.
 */

/** A typical short note. */
export const SHORT_NOTE_TEXT = "Faster onboarding";

/** The word typed in the e2e golden path. */
export const TYPED_GREETING = "Hello";

/** A multi-line retrospective item (3 lines). */
export const MULTILINE_RETRO_TEXT =
  "What went well: the board shipped on time.\n" +
  "What did not: the migration slipped by two weeks.\n" +
  "What to try: agree the work in writing first.";

/** A 1,000 character English paragraph: exactly the text limit. */
export const PROSE_1000 =
  "We started the retrospective by reading every note out loud, which took longer than planned but made sure nobody had to guess what a colleague meant. The clearest theme was onboarding: new customers keep telling us that the first ten minutes decide whether they stay, so the team agreed to rewrite the welcome flow, shorten the first run, and remove every step that asks for information we can collect later. The second theme was communication. Handoffs between design and engineering still lose context, and people said they would rather read a short written summary than sit in another meeting. We closed with three actions, each owned by one person, and a promise to keep the board small enough that anyone can hold the whole picture at once. The next session is in two weeks. Until then the board stays exactly as it is: anyone can add a note, move a related idea next to its neighbours, and recolour a theme when the conversation changes shape. That is exactly what a shared board should be for.";

/** 1,200 characters: a paste that overshoots the limit by 200. */
export const PASTE_1200 =
  PROSE_1000 +
  " The extra characters arrive with the paste and must never reach the board: the note stops at the product limit, the counter reports the limit, and nothing past that limit is ever stored on the board.";

/** One character more than the limit. */
export const OVER_LIMIT_1001 = `${PROSE_1000}x`;
