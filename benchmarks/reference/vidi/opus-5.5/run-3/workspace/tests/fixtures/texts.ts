// Realistic note texts (not repeated single characters, which lay out unrealistically).

export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_ITEM = [
  'Went well: pairing on the release checklist',
  'Could improve: flaky login tests slowed us down',
  'Action: Sam to split the test suite by Friday',
].join('\n');

const PROSE =
  'During the last quarter the team shipped three major releases, and each one taught us something about how we ' +
  'plan work. The first release slipped by a week because the design review happened after development had already ' +
  'started, so several screens had to be rebuilt. For the second release we moved the review earlier and invited ' +
  'support staff, who pointed out that customers mostly struggle with the first five minutes of setup rather than ' +
  'with advanced features. That insight changed our priorities: we simplified the welcome flow, removed two optional ' +
  'steps, and added short hints next to the fields people most often get wrong. The third release went out on time, ' +
  'and support tickets about onboarding dropped noticeably in the following month. Next quarter we want to keep the ' +
  'early reviews, measure activation more carefully, and share what we learn with the sales team so that demos ' +
  'reflect the product people actually use every day, not the one we imagined when we started planning the roadmap. ' +
  'We also agreed to hold a short retrospective after every release, write down one concrete change, and check at ' +
  'the next retrospective whether we really made it.';

/** Exactly `length` characters of English prose (default: the 1,000 character note limit). */
export function prose(length = 1000): string {
  let text = PROSE;
  while (text.length < length) text += ' ' + PROSE;
  return text.slice(0, length);
}

export const LONG_TEXT = prose(1000);

// Story 9 — free text.

/** Section headings on a retro board. */
export const HEADINGS = ['Went well', 'To improve', 'Actions', 'Questions', 'Parking lot'];

/** A 300-character English annotation: longer than one line at the maximum auto width. */
export const ANNOTATION = prose(300);

/** A pasted paragraph one character over the text object limit (TEXT_MAX_CHARS = 5,000). */
export const OVER_LIMIT_PARAGRAPH = prose(5001);
