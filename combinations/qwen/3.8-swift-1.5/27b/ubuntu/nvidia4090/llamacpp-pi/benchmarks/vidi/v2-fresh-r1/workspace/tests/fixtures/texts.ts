// Text fixtures for E2E tests: realistic English prose.

/** Short phrase for a one-word/short note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item (~120 chars). */
export const RETRO_ITEM =
  'What went well:\nWe shipped the new dashboard on time\nand got positive feedback from users.';

/** A 1,000 character paragraph of English prose (not repeated single characters). */
export const LONG_PROSE: string = (
  'The quick brown fox jumps over the lazy dog near the riverbank where willows sway gently in the afternoon breeze. ' +
  'A family of deer grazes quietly in the meadow beyond, their soft breathing barely audible over the murmur of the stream. ' +
  'Children chase each other along the wooden path, their laughter carrying across the water like birdsong. ' +
  'The old stone bridge, mossy and timeless, connects the two sides of the valley where farmers have tended their fields for generations. ' +
  'In the distance, the first peaks of the mountain range catch the early light, their snow caps glowing faintly gold. ' +
  'A red-tailed hawk circles overhead, riding the thermals with effortless grace, its shadow sweeping across the patchwork of green and gold below. ' +
  'The air smells of cut grass and woodsmoke from a distant chimney, and the world feels vast, peaceful, and endlessly alive. '
).slice(0, 1000);
