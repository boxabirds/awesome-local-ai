export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_TEXT = 'Deploys felt slow this sprint\nReviews waited two days\nPair more on the tricky parts';

const SENTENCES = [
  'A good retrospective starts by looking at what actually happened rather than what we remember.',
  'The team shipped three features, but two of them needed a hotfix within a week of release.',
  'Handoffs between design and engineering were smoother once we agreed on a shared checklist.',
  'Several people mentioned that meetings ran long because the agenda was never circulated in advance.',
  'On the positive side, the new onboarding guide saved each newcomer roughly a full day of questions.',
  'We should keep the weekly demo, shorten the planning session, and write down decisions as we make them.',
  'Customers praised the faster search but still struggle to find the export option in the settings menu.',
  'Support tickets about login problems dropped sharply after the password reset flow was rewritten.',
  'Next quarter we want clearer ownership for each area so that questions reach the right person quickly.',
  'Finally, let us celebrate the small wins, because steady progress is easier to sustain than heroic sprints.',
];

/** Exactly 1,000 characters of English prose. */
export const LONG_TEXT = (() => {
  let text = '';
  for (let i = 0; text.length < 1000; i++) text += `${SENTENCES[i % SENTENCES.length]} `;
  return text.slice(0, 1000);
})();
