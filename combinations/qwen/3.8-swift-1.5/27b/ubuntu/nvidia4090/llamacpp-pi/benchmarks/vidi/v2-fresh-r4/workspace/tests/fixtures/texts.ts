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
