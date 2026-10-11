/**
 * Realistic note text fixtures (shared by unit, component and e2e tests).
 * Long fixtures are English prose, not repeated characters, so font measurement
 * lays out the way a real note would.
 */

function exact(text: string, length: number): string {
  if (text.length >= length) {
    return text.slice(0, length);
  }
  // Pad with a readable tail so the fixture is exactly `length` characters.
  const pad = ' The team kept the board tidy and every idea stayed readable.';
  let out = text;
  while (out.length < length) {
    out += pad;
  }
  return out.slice(0, length);
}

/** A short idea, displayed at the maximum font size. */
export const SHORT_NOTE_TEXT = 'Faster onboarding';

/** One word, used for the maximum font-size assertion. */
export const ONE_WORD_TEXT = 'Onboarding';

/** A three-line retrospective item (~120 characters). */
export const RETRO_NOTE_TEXT = [
  'What went well: pairing on the camera maths.',
  'What hurt: no shared board, so notes were lost.',
  'What we will try: one sticky per idea next session.',
].join('\n');

const PROSE_1000 =
  'Teams brainstorm best when every idea is visible to everyone at the same time. ' +
  'A sticky note is the smallest useful unit of collaboration: it captures one thought, ' +
  'it can be moved next to the thoughts it belongs with, and its colour says which theme it ' +
  'belongs to. When the notes are rearranged by hand, an affinity map appears almost for free, ' +
  'and the group can see which themes are crowded and which are empty. The board has to stay ' +
  'readable while this happens, so text shrinks instead of spilling out of the note, and a ' +
  'fade at the bottom edge admits that there is more to read than fits. Nothing here requires ' +
  'a server, an account, or a fast connection; the notes belong to the people standing around ' +
  'the board, and the tool should get out of the way while they are still arguing about where ' +
  'an idea belongs. Short notes look large and confident, long notes shrink to a dense block, ' +
  'and both stay inside the same square so the layout never shifts under someone who is ' +
  'pointing at a specific sentence. When a note turns out to be a duplicate it should vanish ' +
  'with one key press, because nobody wants to spend a retro cleaning up.';

/** A ~150 character note: big enough that the fit search lands mid-range. */
export const MEDIUM_NOTE_TEXT =
  'Design review notes: split the canvas into a world layer and a screen layer, keep camera ' +
  'state out of React, and make every gesture testable.';

/** Exactly 1,000 characters of English prose (the note text limit). */
export const LONG_NOTE_TEXT = exact(PROSE_1000, 1000);

const PROSE_1200 =
  LONG_NOTE_TEXT +
  ' Pasting a wall of text is the stress test: the limit is a product decision, not a layout ' +
  'accident, so the characters after the limit are simply never written to the document. The ' +
  'counter tells the author where they stand before the note silently stops accepting input, ' +
  'and the author can trim the note down to something a reader will actually finish.';

/** 1,200 characters: pasted into a note, only the first 1,000 survive. */
export const OVER_LIMIT_NOTE_TEXT = exact(PROSE_1200, 1200);
