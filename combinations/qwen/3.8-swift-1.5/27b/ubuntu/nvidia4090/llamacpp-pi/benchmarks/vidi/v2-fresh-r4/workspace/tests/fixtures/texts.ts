/**
 * Realistic text fixtures for e2e tests.
 */

/** Short phrase for a quick note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item (~120 chars). */
export const RETRO_ITEM =
  'What went well: team shipped early\nWhat could improve: docs were stale\nAction: assign doc owner by Friday';

/**
 * A 1,000-character English paragraph (not repeated single characters,
 * which lay out unrealistically).
 */
/**
 * A 300-character annotation (story 9 TC-26): long enough to hit the
 * maximum automatic width of a text object and wrap onto several lines.
 */
export const ANNOTATION_300 =
  'This annotation is long enough to hit the maximum automatic width of the text object, so it must wrap onto multiple lines and keep its top-left corner in place while it grows. It keeps going until it reaches exactly three hundred characters in total, no more and no less, which is what the E2E tests.';

export const LONG_PARAGRAPH = (
  'The quick brown fox jumps over the lazy dog near the riverbank. ' +
  'Pack my box with five dozen liquor jugs and carry them home. ' +
  'How vexingly quick daft zebras jump over the fence in the yard. ' +
  'The five boxing wizards jump quickly and dance with grace. ' +
  'Sphinx of black quartz, judge my vow with a steady hand. ' +
  'Clever jack drowns in the misty morning fog near the old mill. ' +
  'Bright purple tulips bloom in the garden by the stone wall. ' +
  'The gentle stream flows past the ancient oak tree in summer. ' +
  'Wild strawberries grow thick along the shady forest path. ' +
  'A red squirrel chatters loudly from the branch above our heads. '
).slice(0, 1000);
