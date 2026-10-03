/**
 * Realistic note text fixtures for sticky note tests. English prose is used
 * instead of repeated single characters so font layout (e2e) is representative.
 */

const SENTENCE =
  'The product team gathered to review the onboarding flow and agreed that clearer empty states would help new users find value faster. ';

/** Build `length` characters of English prose (repeated sentences, sliced). */
function buildProse(length: number): string {
  let out = '';
  while (out.length < length) out += SENTENCE;
  return out.slice(0, length);
}

/** A short note (the PRD golden-path idea). */
export const SHORT_NOTE = 'Faster onboarding';

/** A multi-line retrospective item (~120 characters across three lines). */
export const RETRO_ITEM =
  'What went well: shipped the camera.\nWhat to improve: note persistence.\nAction: sync the board next sprint.';

/** Exactly 949 / 950 / 951 characters (counter threshold boundaries). */
export const PROSE_949 = buildProse(949);
export const PROSE_950 = buildProse(950);
export const PROSE_951 = buildProse(951);

/** Exactly 999 / 1000 / 1001 / 1200 characters (text limit boundaries). */
export const PROSE_999 = buildProse(999);
export const PROSE_1000 = buildProse(1000);
export const PROSE_1001 = buildProse(1001);
export const PROSE_1200 = buildProse(1200);
