/**
 * Text fixtures for E2E tests.
 * Realistic English text, not repeated single characters.
 */

/** Short phrase for basic text editing tests. */
export const SHORT_PHRASE = 'Hello World'

/** A typical retro board item (3 lines). */
export const RETRO_ITEM = `Sprint demo went well but
the CI pipeline was flaky on
Tuesday and Wednesday.`

/**
 * A 1,000-character English paragraph for long-text tests.
 * Exact length is enforced by the test (1,000 characters).
 */
export const LONG_PARAGRAPH =
  'The quick brown fox jumps over the lazy dog near the riverbank where ' +
  'several children were playing a game of tag under the shade of ancient ' +
  'oak trees whose roots twisted deep into the soft earth beside a narrow ' +
  'footpath that led through the meadow toward a small village with a red ' +
  'roofed church visible on the hilltop in the distance. Birds sang in the ' +
  'branches overhead while a gentle breeze carried the scent of wildflowers ' +
  'across the field. A farmer walked his dog along the hedgerow checking ' +
  'fence posts that had been weakened by last week storms. He paused at a ' +
  'gate to watch the children play before continuing toward the barn where ' +
  'he needed to repair a tractor engine before the weekend harvest began. ' +
  'The afternoon sun slowly moved across the western sky painting long ' +
  'shadows across the grass as the sound of distant laughter faded into ' +
  'the peaceful quiet of the countryside settling into the warmth of early ' +
  'summer evening light that lingered well past the usual hour of dusk'

/** Verify fixture is exactly 1000 chars (trim if needed). */
export const LONG_PARAGRAPH_1000 = LONG_PARAGRAPH.slice(0, 1000)
