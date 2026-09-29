/**
 * Story 2 · text fixtures (design "Fixtures").
 *
 * Realistic English text, not repeated single characters: a one-word phrase,
 * a three-line retro item and a 1,000-character prose paragraph. The long
 * fixture lays out like real prose so the font-fit / overflow tests in e2e are
 * meaningful.
 */

/** Short phrase. */
export const SHORT_TEXT = 'Faster onboarding';

/** Three-line retro item (~120 chars). */
export const RETRO_TEXT =
  'What slowed us down:\nManual deploys kept breaking staging.\nWe want preview environments per branch.';

/**
 * A 1,000-character paragraph of English prose. Built from a fixed sentence
 * pool so the length is exactly 1,000 and the layout is realistic (varied word
 * lengths, punctuation, spaces).
 */
export const LONG_TEXT: string = (() => {
  const pool =
    'We sketched the whole roadmap on the board during the retrospective, ' +
    'grouped the notes by theme, and then rearranged them until each idea ' +
    'sat beside the work it actually described. It read like a real plan. ';
  let text = '';
  while (text.length < 1000) text += pool;
  return text.slice(0, 1000);
})();