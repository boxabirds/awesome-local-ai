export const SHORT_TEXT = 'Faster onboarding';
export const RETRO_TEXT = 'Went well: the release was calm\nNeeds work: handovers between teams are slow\nTry next: a shared checklist for launches';

const SENTENCE =
  'Teams that capture ideas quickly and regroup them next to related thoughts tend to find patterns that nobody noticed alone. ';
export const LONG_TEXT = SENTENCE.repeat(9).slice(0, 1000);
export const OVER_LIMIT_TEXT = (SENTENCE.repeat(11) + SENTENCE).slice(0, 1200);
