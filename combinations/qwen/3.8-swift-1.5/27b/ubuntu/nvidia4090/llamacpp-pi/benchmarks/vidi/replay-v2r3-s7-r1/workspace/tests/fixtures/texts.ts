/**
 * Realistic note-text fixtures shared by the unit and e2e tests.
 *
 * The design spec requires "a 1,000 character paragraph of English prose (not
 * repeated single characters, which lay out unrealistically)".
 */

export const SHORT_TEXT = 'Faster onboarding';

export const MULTILINE_RETRO = [
  'What went well: we shipped the new onboarding flow ahead of schedule.',
  'What did not work: the toolbar felt cluttered for first-time users.',
  'Action: add a short tooltip to every toolbar button before the next release.',
].join('\n');

/** Exactly 1,000 characters of English prose. */
export const LONG_TEXT =
  'The team wants the whiteboard to feel calm and fast, so that a quick idea captured during a standup lands on the board in under a second and never blocks the person who typed it. Every note should be easy to move, easy to recolour, and easy to delete, with the keyboard and the mouse doing exactly what the user expects. We measured the current prototype and found that dragging a note at high zoom felt laggy, that long notes overflowed their box without any hint, and that the character limit was not visible until it was already reached. The plan is to keep the note a fixed size in world space, to fit the text by shrinking the font only as much as needed, and to show a small counter when the user is close to the limit. We will verify the layout with real fonts in the browser, because the exact wrapping depends on the operating system and the installed typefaces. If a note holds a thousand characters it should still be readable, with a gentle fade at the bottom telling the reader that ther';

// Guard the invariant in CI: the e2e font-fit test depends on the exact length.
if (LONG_TEXT.length !== 1000) {
  throw new Error(`LONG_TEXT must be exactly 1000 chars, got ${LONG_TEXT.length}`);
}
