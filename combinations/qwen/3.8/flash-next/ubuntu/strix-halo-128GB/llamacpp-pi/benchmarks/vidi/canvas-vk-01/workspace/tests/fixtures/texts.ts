/**
 * Test fixtures for sticky note e2e tests.
 * Uses realistic English text, not repeated single characters.
 */

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = `What went well this sprint?
- Team collaboration improved significantly
- Deployment pipeline reduced from 45 to 12 minutes`;

export const PROSE_1000: string = (() => {
  const sentence =
    'The quick brown fox jumps over the lazy dog near the riverbank while the sun sets behind the distant mountains casting long golden shadows across the meadow. ';
  let text = '';
  while (text.length < 1000) {
    text += sentence;
  }
  return text.slice(0, 1000);
})();
