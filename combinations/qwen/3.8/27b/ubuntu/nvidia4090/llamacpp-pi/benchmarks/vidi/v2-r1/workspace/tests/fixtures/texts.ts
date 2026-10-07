// Realistic note text fixtures for story 2 tests.
// Prose is real English (not repeated single characters, which lay out
// unrealistically in font-fit measurements).

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM =
  'We shipped the new checkout on Tuesday and tickets dropped by a third.\n' +
  'It helped most for first-time buyers on mobile.\n' +
  'Next time we should pair up earlier in the cycle.';

const BASE_PROSE =
  'The planning session started with a quiet room and a board full of open questions. ' +
  'Each team member took a marker and began marking the ideas that mattered most to them, ' +
  'grouping similar thoughts together and stepping back to look for the shape of the whole. ' +
  'Some notes moved again and again as the group negotiated what to do first and what to drop. ' +
  'The discussion drifted between the launch plan and the support backlog, and someone finally ' +
  'suggested a colour for each theme, which made the picture suddenly easier to read. ' +
  'By the end of the hour the board told a story: a small number of clear themes, a few risks ' +
  'that nobody wanted to own yet, and a short list of next steps that everyone agreed to. ' +
  'The session ended with the photo already taken and the link shared with the people who ' +
  'could not be in the room, so the thinking could continue without waiting for the next meeting.';

/** English prose of exactly `length` characters. */
export function makeProse(length: number): string {
  let out = '';
  while (out.length < length) {
    out += BASE_PROSE + ' ';
  }
  return out.slice(0, length);
}

export const PROSE_1000 = makeProse(1000);
export const PROSE_1200 = makeProse(1200);
