export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_TEXT = [
  'Release notes were confusing',
  'Deploys took too long on Friday',
  'Pairing sessions worked really well',
].join('\n');

const SENTENCE = 'The team gathered around the board to talk through what had gone well during the sprint, '
  + 'which blockers kept reappearing, and how small experiments might improve the way work flows between people. ';

/** Exactly 1,000 characters of English prose. */
export const LONG_TEXT = SENTENCE.repeat(6).slice(0, 1000);

/** 1,200 characters of English prose. */
export const OVER_LIMIT_TEXT = SENTENCE.repeat(8).slice(0, 1200);
