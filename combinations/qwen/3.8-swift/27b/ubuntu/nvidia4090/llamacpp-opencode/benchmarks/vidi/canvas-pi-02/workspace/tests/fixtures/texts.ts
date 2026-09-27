// Realistic note-text fixtures shared by unit and e2e tests (story 2).
// Real English prose, not repeated single characters, which lay out
// unrealistically.

/** Short phrase (one word note → largest font). */
export const SHORT_PHRASE = 'Faster onboarding';

/** A three-line retro item (~120 chars). */
export const RETRO_ITEM =
  'What went well: the release train ran on time.\n' +
  'What hurt: on-call handoff notes were thin.\n' +
  'Action: pair on the runbook this week.';

/** A 1,000-character English paragraph (the sticky text limit, exactly). */
export const PROSE_1000 =
  'The team gathered around the board to map out the onboarding journey, tracing each step from the first click to the moment a new user ships their very first real project. Notes in yellow gathered the friction points they had heard from support, while orange captured the ideas that needed a quick prototype before anyone would commit to them. Green marked the quick wins that could land next sprint, blue held the questions that the growth team would have to answer, and pink kept the risks that everyone agreed had to be watched closely. As the afternoon wore on the board grew dense with ideas, some crossed out, some moved twice, and a few pinned firmly in the middle where the whole team could see that they had finally found the shape of the work ahead of them. They agreed to revisit the flow after the next release, bringing fresh data and a lighter touch to the whole conversation. In the end, the board did what good boards do: it turned two hours of scattered notes into a shared next step.';

/** 1,200 characters of prose (pasting over the limit). */
export const PROSE_1200 =
  PROSE_1000 +
  ' The following week the changes went live, and the board was cleared away until the next idea needed a home, when the whole team returned with fresh questions and an even longer list of notes to sort.';

/** n characters of the 1,000-char paragraph (0..1000). */
export function proseOfLength(n: number): string {
  return PROSE_1000.slice(0, n);
}
