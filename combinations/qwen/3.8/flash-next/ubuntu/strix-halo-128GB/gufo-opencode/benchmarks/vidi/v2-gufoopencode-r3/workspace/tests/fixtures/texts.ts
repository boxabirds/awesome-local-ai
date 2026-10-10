// Realistic note-text fixtures (design "Fixtures"): a short phrase, a
// multi-line retro item and an exactly-1,000-character English paragraph.

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = [
  'What went well: we shipped the beta two weeks early,',
  'support tickets dropped by forty percent after the',
  'onboarding revamp, and the demo landed on the blog.'
].join('\n');

const SENTENCE =
  'The team gathered around the shared board to capture every idea on a bright square note, ' +
  'then dragged the notes into clusters until related themes sat side by side and the whole ' +
  'room could see the shape of the plan taking form. ';

export const PROSE_1000: string = SENTENCE.repeat(12).slice(0, 1000);

export const PROSE_1200: string = SENTENCE.repeat(12).slice(0, 1200);
