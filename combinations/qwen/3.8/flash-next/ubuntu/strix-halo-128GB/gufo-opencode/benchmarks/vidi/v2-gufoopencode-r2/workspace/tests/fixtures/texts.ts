// Realistic note-text fixtures (design: Fixtures). English prose, never
// repeated single characters, so text layout in tests is realistic.

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = [
  'Release notes arrived two days after the deploy, so half the team',
  'answered support tickets from memory instead of the documented',
  'changelog; we should automate publishing them with the build tag.',
].join('\n');

// Exactly 1,000 characters of English prose (no trailing newline).
export const PROSE_1000 =
  'The quick brown fox jumps over the lazy dog while the team gathers around the ' +
  'whiteboard to map out the next quarter. Ideas pile up faster than anyone can ' +
  'sort them, so we agree to write one thought per sticky note, colour code them ' +
  'by theme, and group the notes into columns before the coffee runs out. ' +
  'Rearranging the board is just as important as filling it, because an affinity ' +
  'map only becomes useful once similar ideas sit next to each other and the ' +
  'stragglers find a home. When the last note lands in place, the shape of the ' +
  'plan is suddenly visible to everyone in the room, and the discussion shifts ' +
  'from what to build to what to build first. That shift is the whole point of ' +
  'the exercise, and it only happens when moving ideas around feels effortless, ' +
  'instant, and completely reversible for every participant who joins the board. ' +
  'Everyone leaves the room with one shared list, an owner named beside each ' +
  'action, and a date in the calendar for the very next mapping session together ' +
  'for real.';

// 1,200 characters: PROSE_1000 plus exactly 200 more, for the paste-limit test.
export const PROSE_1200 = PROSE_1000 +
  ' Afterwards the team retires the board, but not before one final note, blue ' +
  'this time, quietly thanks the facilitator for the clearest planning hour the ' +
  'group has shared this year and all said so too.';

export function repeatWord(word: string, targetLength: number): string {
  let out = '';
  while (out.length < targetLength) out += (out ? ' ' : '') + word;
  return out.slice(0, targetLength);
}
