/**
 * Realistic note text fixtures. The design asks for English prose rather than
 * repeated single characters, which lay out unrealistically and would hide
 * font-fit and wrapping bugs.
 */

/** A short idea, shown at the maximum font size. */
export const SHORT_TEXT = 'Faster onboarding';

/** A three-line retrospective item, ~120 characters. */
export const RETRO_TEXT = [
  'What went well: we shipped the beta on time and the',
  'team stayed in flow all sprint with far fewer handoffs',
  'than the last cycle across every squad that joined.',
].join('\n');

const PROSE =
  'The quick brown fox jumps over the lazy dog while the team gathers around the ' +
  'whiteboard to map out the next quarter. Ideas cluster and separate as the ' +
  'conversation moves, and sticky notes drift across the surface until related ' +
  'themes sit side by side. A good facilitator keeps the energy high, asks sharp ' +
  'questions, and refuses to let a single loud voice dominate the room. When the ' +
  'morning session ends, the wall tells a story of what worked, what hurt, and ' +
  'what we will try next time. Everyone leaves with a clearer picture of the ' +
  'priorities and a handful of concrete actions to own before we meet again. ';

/**
 * Exactly 1,000 characters of English prose (repeated real sentences, never a
 * single repeated character). Long enough that at the smallest font size it
 * still overflows a 200x200 note, so the fade is exercised. The slice pins the
 * length to exactly the 1,000 character limit; the tests assert it.
 */
export const THOUSAND_TEXT = (PROSE + ' ').trim().repeat(3).slice(0, 1000);
