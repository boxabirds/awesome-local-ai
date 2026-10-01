export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_TEXT = 'Deploys are too slow\nWe wait on flaky tests\nLet us parallelise the suite';

const SENTENCE =
  'A good retrospective gives every person on the team a chance to say what slowed them down, what helped, and what they would like to try next sprint. ';

/** Exactly 1,000 characters of English prose. */
export const LONG_TEXT = SENTENCE.repeat(7).slice(0, 1000);

/** 1,200 characters of English prose, for over-limit paste tests. */
export const OVER_LIMIT_TEXT = SENTENCE.repeat(9).slice(0, 1200);
