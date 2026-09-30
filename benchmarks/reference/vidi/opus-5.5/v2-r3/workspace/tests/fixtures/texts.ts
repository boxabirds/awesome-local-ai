// Realistic note texts (design "Fixtures").

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM =
  'Went well: pairing on the release checklist\nImprove: flaky CI on Mondays\nTry: demo every Friday afternoon';

const PROSE =
  'Our onboarding flow asks new customers for too much information before they see any value. ' +
  'In the last quarter, almost half of the people who started the sign-up form never reached the ' +
  'first board. Interviews suggest they wanted to try the product with a colleague straight away, ' +
  'but the invitation step was hidden behind billing details. We could let people create a board ' +
  'first and ask for company details later, once they have invited someone and added a few notes. ' +
  'Support also reports confusion about workspace names, which many users leave empty or fill with ' +
  'placeholder text. A shorter form, a sample board with example notes, and a clear link to invite ' +
  'teammates might reduce the drop-off considerably. Before building anything, the team should agree ' +
  'on how to measure success, for example the share of new accounts that add five notes in the first ' +
  'day, and review the numbers again after a month. Sales would like the change to keep the optional ' +
  'demo request visible for larger companies. ';

/** Exactly 1,000 characters of English prose. */
export const LONG_PARAGRAPH_1000 = (PROSE + PROSE).slice(0, 1000);

/** 1,200 characters of English prose (over the limit). */
export const LONG_PARAGRAPH_1200 = (PROSE + PROSE).slice(0, 1200);

/** Prose of exactly `n` characters (n <= 2 * prose length). */
export function proseOfLength(n: number): string {
  const text = (PROSE + PROSE).slice(0, n);
  if (text.length !== n) throw new Error(`fixture too short for ${n}`);
  return text;
}
