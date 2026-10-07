/**
 * Realistic note text fixtures (design "Fixtures"): a short phrase, a multi-line
 * retrospective item, and a 1,000 character English paragraph. Long fixtures are
 * prose, never repeated single characters, because layout (wrapping and font fit)
 * depends on word lengths.
 */

/** Short phrase from the PRD golden path. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item (3 lines, ~120 characters). */
export const RETRO_ITEM =
  'What went well: we shipped the board without a backend and\n' +
  'measured load time on a slow laptop, which kept the bundle\n' +
  'small enough that the demo never stuttered in the room.';

/**
 * English prose used for the 1,000 character limit and the font-fit tests.
 * Assembled from sentences and cut to exactly 1,000 characters.
 */
const PROSE_SENTENCES = [
  'Collaborative whiteboards work because they keep a room of people looking at the same idea at the same time.',
  'When a note can be written, moved and recoloured in a second, the conversation stays about the idea rather than about the tool.',
  'Groups of notes slowly become categories, and categories slowly become a plan that everybody in the room agrees to.',
  'A sticky note that is too small to read defeats the point, so the text has to stay legible no matter how much somebody pastes into it.',
  'Rearranging ideas is thinking made visible: an idea moves next to a related one the moment the connection is noticed.',
  'Colour is the cheapest way to show ownership or theme, which is why every team reaches for the green marker first.',
  'The best tools disappear, leaving nothing between a group of people and the shape of their shared understanding.',
];

function buildProse(target: number): string {
  let text = PROSE_SENTENCES.join(' ');
  while (text.length < target) text += ' ' + PROSE_SENTENCES.join(' ');
  // Cut at exactly `target` characters, like a real over-long paste would.
  return text.slice(0, target);
}

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of English prose. */
export const PROSE_1000 = buildProse(1000);

/** 1,200 characters of the same prose: a paste that must be clamped. */
export const PROSE_1200 = buildProse(1200);

/** Build a realistic prose fixture of exactly `n` characters. */
export function proseOfLength(n: number): string {
  return buildProse(n);
}
