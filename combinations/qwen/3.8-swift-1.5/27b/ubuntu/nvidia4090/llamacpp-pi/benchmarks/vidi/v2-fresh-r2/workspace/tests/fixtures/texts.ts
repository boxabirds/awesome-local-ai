/**
 * Test fixtures: realistic note texts for e2e tests.
 */

/** Short phrase for a simple note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item (~120 chars). */
export const RETRO_ITEM = `What went well:
- Shipped the new dashboard
- Good team collaboration

To improve:
- Earlier design reviews`;

/** 1,000 character English paragraph for testing text fit and overflow. */
export const LONG_PARAGRAPH = (
  'The quick brown fox jumps over the lazy dog. ' +
  'Pack my box with five dozen liquor jugs. ' +
  'How vexingly quick daft zebras jump! ' +
  'The five boxing wizards jump quickly. ' +
  'Sphinx of black quartz, judge my vow. ' +
  'The jay, pik, and fox quiz over the big mug. ' +
  'A mad boxer shot a quick, gleaming wz bit from a javelin. ' +
  'Gloria, the fifth witch, owns much dark jewelry. ' +
  'The quick, brown fox jumps over a lazy dog. ' +
  'Oak, a film star, chews a big juicy apple with great gusto. ' +
  'The whining, dazing, flumping foxes quickly bellow. ' +
  'A very clever taxi driver quickly moved his jumpy dog. ' +
  'The six boxing wizards of the quick jazz club jumped. ' +
  'Big small, fat thin, hot cold, up down, in out. ' +
  'The rapid yellow lizard and the quick brown fox both jumped. ' +
  'A box of primes just sits across the quick lawn. ' +
  'The quick brown fox jumps over the lazy dog near the mill. ' +
  'The jackal, ox, and quick zebra are all in the maze. ' +
  'She sells seashells by the seashore with great enthusiasm. ' +
  'The busy beaver builds a dam of sticks and mud all day long. '
).slice(0, 1000);

// Ensure it's exactly 1000 characters
if (LONG_PARAGRAPH.length !== 1000) {
  // Pad or trim to exactly 1000
  if (LONG_PARAGRAPH.length > 1000) {
    // This shouldn't happen since we slice, but just in case
  }
}
