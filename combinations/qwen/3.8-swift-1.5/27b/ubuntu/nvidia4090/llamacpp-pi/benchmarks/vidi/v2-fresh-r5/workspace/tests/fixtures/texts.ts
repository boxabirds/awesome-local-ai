// Realistic text fixtures for e2e tests.

/** Short phrase for a simple note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** Multi-line retro item (~120 chars). */
export const RETRO_ITEM = 'What went well:\n- Shipped the new dashboard\n- Great team collaboration\n\nAction items:\n- Document the API changes';

/**
 * A 1,000-character English paragraph (not repeated single characters,
 * which would lay out unrealistically).
 */
export const LONG_PARAGRAPH_1000 = buildText(1000);

function buildText(targetLen: number): string {
  const sentences = [
    'The quick brown fox jumps over the lazy dog near the old stone bridge.',
    'Rivers meet where willows bend over quiet waters reflecting clouds.',
    'Birds circle above the fields as the afternoon sky turns pale gold.',
    'A mad boxer shot a few gloved left hooks at the training dummy.',
    'Bright vixens jump while dozy fowl quack in the muddy paddock.',
    'Pack my box with five dozen liquor jugs before the party starts.',
    'How vexingly quick daft zebras jump when the circus arrives.',
    'Jackdaws love my big sphinx of quartz that sits in the garden.',
    'Sphinx of black quartz judge my vow before the sun sets low.',
    'The five boxing wizards jump quickly over the cobblestones.',
  ];
  let result = '';
  let i = 0;
  while (result.length < targetLen) {
    if (result.length > 0) result += ' ';
    result += sentences[i % sentences.length];
    i++;
  }
  return result.slice(0, targetLen);
}
