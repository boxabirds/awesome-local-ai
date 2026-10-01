import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/**
 * Realistic note text fixtures. Long text is real English prose (not a repeated single
 * character), because word wrapping and line breaking only behave realistically with words,
 * spaces and punctuation.
 */

/** Short phrase used on the golden path. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retrospective item: three lines, ~120 characters. */
export const RETRO_ITEM =
  'What slowed us down last sprint:\n' +
  'reviews sat for two days, nobody owned the queue,\n' +
  'and staging was reset twice without warning.';

const PROSE =
  'The team met on a grey Tuesday morning to talk about the onboarding flow, because new ' +
  'hires kept saying that the first week felt like a scavenger hunt without a map. Access to ' +
  'the repository arrived on the fourth day, the design system lived in three different ' +
  'folders, and nobody could point at a single source of truth for the roadmap. Someone ' +
  'suggested a written checklist for the first five days, another suggested pairing with a ' +
  'buddy for the whole first week, and a third pointed out that none of it mattered if the ' +
  'test environment stayed broken. We argued about whether the problem was tooling or ' +
  'communication, agreed it was both, and wrote the reasons down on sticky notes so the ' +
  'following group could sort them into themes instead of starting from a blank board again. ' +
  'By the end of the hour the wall was covered in colour, and the colours meant something: ' +
  'yellow for the flow itself, orange for anything that blocked a person on their first day, ' +
  'green for the small fixes we could ship this week, and blue for the questions we would ' +
  'have to ask someone else before we could decide anything at all.';

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of English prose. */
export const LONG_TEXT = `${PROSE} Then we read every note aloud to the room.`.slice(0, STICKY_TEXT_MAX_CHARS);

/** Longer than the limit: used to check the paste is cut off at exactly the limit. */
export const OVERLONG_TEXT = `${LONG_TEXT} This trailing sentence is beyond the limit and must be dropped.`;
