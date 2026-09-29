/** Realistic English prose fixtures for sticky note tests (not repeated characters). */

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = [
  'Release notes landed three days after the deploy, so half the team read them',
  'after the follow-up meeting had already happened. We want the summary in one',
  'place, linked from the sprint board and written for people outside the team.',
].join('\n');

const PROSE_SENTENCES = [
  'The team reflected on the onboarding experience and how confusing the first week felt to new hires.',
  'Documentation was scattered across wikis, chat threads and the tribal knowledge of long-time staff.',
  'New hires asked for a single checklist they could follow at their own pace without interrupting anyone.',
  'Mentors suggested pairing sessions during the first two sprints to build confidence early.',
  'Follow-up actions were captured as sticky notes and grouped by theme on the shared board.',
  'A short review at the end of each week showed the groups drifting closer together over time.',
  'Several people noted that colour coding by owner made the wall much easier to read at a glance.',
  'The retrospective closed with an agreement to keep the board open between sessions for async input.',
];

/** English prose of the requested length (>=14 characters). */
export function proseOfLength(target: number): string {
  let out = '';
  let i = 0;
  while (out.length < target) {
    const sentence = PROSE_SENTENCES[i % PROSE_SENTENCES.length];
    out += (out.length ? ' ' : '') + sentence;
    i++;
  }
  return out.slice(0, target);
}

export const PROSE_1000 = proseOfLength(1000);
