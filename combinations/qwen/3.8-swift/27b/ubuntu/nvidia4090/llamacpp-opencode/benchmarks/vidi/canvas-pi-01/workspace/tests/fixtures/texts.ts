// Shared text fixtures for story 2 tests (spec: Fixtures) — realistic prose,
// never repeated single characters (which lay out unrealistically).

/** Short phrase for a single-line note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item (3 lines, ~120 chars). */
export const RETRO_ITEM =
  'Went well: the new signup flow\nShipped on schedule with no\nblocking issues, tickets stayed flat.';

/** Exactly 1,000 characters of English prose (STICKY_TEXT_MAX_CHARS). */
export const THOUSAND_CHAR_PARAGRAPH =
  'The workshop started with a short silence before anyone wrote the first note. We agreed that every idea deserved the same paper, the same size, the same chance to be moved around the table. Half the team filled the wall with small yellow squares, each one a fragment of a longer conversation about onboarding, billing and the empty state that users meet first. Someone suggested that the notes should speak in the customer\'s words, so we rewrote three of them and read them out loud, one at a time, until the room nodded slowly. By the end of the afternoon the board told a story: a confused first visit, a painful second attempt, and a quiet third step where the product finally felt obvious and calm. We kept the best notes pinned near the door and promised to turn them into issues before the next sprint planning, so that the wall would not become a museum of good intentions and forgotten afternoons. Two weeks later we compared the board with the shipped release and found that most of the squa';

/** 1,200 characters — pasting this must clamp to the 1,000 limit. */
export const TWO_THOUSAND_CHARS_PARAGRAPH =
  THOUSAND_CHAR_PARAGRAPH +
  'res had survived the journey intact and only a few had been rewritten to be braver than the room first dared to make them. The team agreed that the wall had captured what stand-ups had only hinted at.';
