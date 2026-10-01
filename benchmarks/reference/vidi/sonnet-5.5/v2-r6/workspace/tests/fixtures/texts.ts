export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_TEXT = [
  'Deploys on Friday afternoons keep',
  'breaking the weekend for the on-call',
  'engineer; let us agree on a freeze window.',
].join('\n');

const SENTENCES = [
  'A good retrospective starts by looking at what actually happened rather than what we remember.',
  'Teams that write down their ideas before discussing them hear from more voices and anchor less on the loudest opinion.',
  'Sticky notes make grouping easy because moving a note next to another one costs nothing at all.',
  'When themes emerge, give each cluster a short name so that the whole group can refer to it later.',
  'Votes help the group decide which cluster deserves attention first, and owners turn it into a concrete next step.',
  'Keep the follow-up list short; three actions that really happen beat ten that are forgotten by Monday morning.',
  'Revisit the previous list at the start of the next session to see which commitments were kept and which slipped.',
  'Celebrate small wins as well, because a team that notices its progress is far more likely to keep improving steadily.',
  'Finally, remember that the board is only a tool, and the conversation around it is where the real learning happens.',
];

/** Exactly 1,000 characters of English prose. */
export const LONG_TEXT = (() => {
  let s = '';
  let i = 0;
  while (s.length < 1000) s += `${SENTENCES[i++ % SENTENCES.length]} `;
  return s.slice(0, 1000);
})();
