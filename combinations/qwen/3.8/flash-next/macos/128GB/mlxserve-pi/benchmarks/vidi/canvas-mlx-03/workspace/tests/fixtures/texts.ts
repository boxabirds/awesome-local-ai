// Realistic text fixtures for sticky-note tests. Uses real English prose (not a
// repeated single character, which lays out unrealistically for font-fit tests).

export const SHORT_PHRASE = 'Faster onboarding';

// A three-line retrospective item (~120 chars).
export const RETRO_ITEM =
  'What went well: we shipped the migration ahead of schedule.\n' +
  'What to improve: review turnaround was slow mid-sprint.\n' +
  'Action: rotate a dedicated reviewer each week.';

function buildProse(len: number): string {
  const sentences = [
    'The team agreed to pilot the new onboarding flow with a small group first. ',
    'Clear ownership of each stage reduced handoff delays across the squad. ',
    'We collected feedback every Friday and folded it into the next iteration. ',
    'Documentation stayed current because updates shipped with the code review. ',
    'Small, frequent releases made problems easier to spot and cheaper to fix. ',
    'Everyone kept the shared board tidy by grouping related ideas together. ',
  ];
  let out = '';
  let i = 0;
  while (out.length < len) {
    out += sentences[i % sentences.length];
    i++;
  }
  return out.slice(0, len);
}

// Exactly 1,000 characters of English prose (the text length limit fixture).
export const LONG_TEXT_1000 = buildProse(1000);
// A paste that exceeds the limit by 200 characters.
export const PASTE_1200 = buildProse(1200);
