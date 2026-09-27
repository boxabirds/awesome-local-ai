// Realistic note text fixtures for tests (not repeated single characters,
// which lay out unrealistically).

export const SHORT_PHRASE = 'Faster onboarding';

// A ~120 character, 3-line retrospective item.
export const RETRO_ITEM =
  'Weekly retro: we shipped the importer but the export path still slips every ' +
  'sprint; let us time-box it and pair.';

// A 1,000-character paragraph of natural English prose. Built once at module
// load by concatenating sentences until exactly 1,000 characters long.
function buildThousand(): string {
  const sentences = [
    'The team gathered to review how the onboarding flow had changed since launch. ',
    'Feedback from new users was mixed, and many asked for clearer guidance. ',
    'Some people finished in a few minutes while others returned several times. ',
    'We agreed to simplify the copy and to show progress at each meaningful step. ',
    'A short tour would help, but only if it respects the user and never repeats. ',
    'Metrics would tell us whether the changes truly reduced confusion or noise. ',
    'For now the plan stays small so that we can learn quickly and adjust course. ',
  ];
  let out = '';
  let i = 0;
  while (out.length < 1000) {
    out += sentences[i % sentences.length];
    i++;
  }
  // Trim or pad deterministically to exactly 1,000 characters of prose.
  if (out.length > 1000) out = out.slice(0, 1000);
  while (out.length < 1000) out += ' end.';
  return out.slice(0, 1000);
}

export const LONG_PROSE_1000 = buildThousand();
