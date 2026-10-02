/**
 * Realistic note text fixtures for story 2 tests.
 * Prose, not repeated single characters (which lay out unrealistically).
 */

const PROSE =
  'The team gathered in the room with the whiteboard wall to plan the next release. ' +
  'They pinned one sticky note per idea, starting with the complaints they heard most often from customers: ' +
  'slow onboarding, confusing billing pages, and a search that returned too many near misses. ' +
  'As the notes multiplied, patterns emerged. Three clusters formed on their own, one around the first-run experience, ' +
  'one around pricing transparency, and one around search quality. The facilitator asked everyone to step back and ' +
  'read the wall from across the room, and the clusters became obvious. They argued for about twenty minutes about ' +
  'which cluster to attack first, weighing effort against impact, and finally chose onboarding because it touched ' +
  'every new customer and the fix was mostly copy and one small flow change. By the end of the hour the wall told a ' +
  'clear story: a short list of bets, each owned by a named person, each with a rough size and a date to revisit. ' +
  'The notes stayed up for a week so anyone walking past could add a thought, and the cluster that grew the most ' +
  'became the team\u2019s next project. Nobody took the wall down until the bets had their first review, which kept the ideas honest. ' +
  'A photo of the full wall went into the release notes so the reasoning would survive the cleanup.';

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM_3_LINES = [
  'Went well: launch went smoothly, tickets stayed low.',
  'Did not: deploys blocked on one approver for 2 days.',
  'Action: add a second on-call approver.',
].join('\n');

export const LONG_PROSE_1000 = PROSE.slice(0, 1000);
export const LONG_PROSE_1200 = PROSE.slice(0, 1200);
