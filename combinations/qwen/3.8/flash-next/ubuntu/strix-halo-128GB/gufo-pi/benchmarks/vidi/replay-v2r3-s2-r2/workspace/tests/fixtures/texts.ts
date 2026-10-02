/** Shared realistic text fixtures for sticky note tests. */

export const SHORT_PHRASE = 'Faster onboarding';

/** A ~120 character, three-line retrospective item. */
export const THREE_LINE_RETRO = [
  'What went well: shipped the beta on time.',
  'What to improve: slower than hoped on review turnaround.',
  'Action: pair on the flaky integration tests next sprint.',
].join('\n');

function buildProse(targetLength: number): string {
  const sentences = [
    'The team gathered to plan the next quarter of work.',
    'Ideas were written on sticky notes and grouped by theme.',
    'Each cluster revealed a shared concern worth exploring.',
    'Priorities emerged after a short round of silent voting.',
    'The facilitator summarised the themes for everyone present.',
    'Follow up tasks were assigned before the session ended.',
  ];
  let out = '';
  let i = 0;
  while (out.length < targetLength) {
    out += (out ? ' ' : '') + sentences[i % sentences.length];
    i += 1;
  }
  return out.slice(0, targetLength);
}

/** A 1,000 character paragraph of English prose (not repeated characters). */
export const PROSE_1000 = buildProse(1000);
