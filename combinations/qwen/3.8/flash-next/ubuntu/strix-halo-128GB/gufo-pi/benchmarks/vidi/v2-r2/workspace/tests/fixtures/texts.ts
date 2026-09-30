// Realistic note text fixtures for tests.

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM =
  'We should have involved QA earlier in the sprint.\n' +
  'The handoff between design and dev was unclear.\n' +
  'Daily standups were running 40 minutes.';

// 1,000-character English prose paragraph (not repeated single characters)
export const PROSE_1000 =
  'The quick brown fox jumps over the lazy dog near the riverbank where wildflowers ' +
  'bloom in early spring and children play under the shade of ancient oak trees. ' +
  'Scientists have discovered that bees communicate through intricate dance patterns, ' +
  'revealing the location of nectar sources to their hive mates with remarkable precision. ' +
  'The history of cartography stretches back thousands of years, from clay tablets to ' +
  'satellite imagery. Music has the power to evoke deep emotions, connecting people across ' +
  'cultures and generations in shared experiences of rhythm and melody that transcend language. ' +
  'Mathematics provides the universal language through which we describe the natural world, ' +
  'from the spiral of a nautilus shell to the orbits of distant galaxies. Collaboration drives ' +
  'innovation forward when diverse teams come together with shared purpose and mutual respect.';

// Ensure it's exactly 1000 chars (pad or trim as needed)
export const FIXTURE_1000 = PROSE_1000.slice(0, 1000).padEnd(1000, ' ');
