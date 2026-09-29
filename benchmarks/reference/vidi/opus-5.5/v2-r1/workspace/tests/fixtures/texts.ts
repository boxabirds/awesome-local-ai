/** Realistic sticky note texts. */
export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_ITEM =
  'What went well: pairing on the billing bug\nWhat to improve: flaky CI on Fridays\nAction: rotate release captain';

const PROSE =
  'Our onboarding flow asks new customers for too much information before they see any value. ' +
  'In interviews, several people said they almost gave up at the company details step, and the ' +
  'analytics confirm that almost a third of sign-ups leave the form there. We could postpone the ' +
  'billing questions until the first invoice, prefill the workspace name from the email domain, ' +
  'and show a sample board right away so people can try things before committing. Support also ' +
  'reports that the welcome email arrives late and links to an outdated guide, which creates ' +
  'tickets during the first week. A short checklist inside the product, with three or four tasks ' +
  'and a progress bar, might help teams discover sharing and comments sooner. Before building ' +
  'anything we should agree on one success metric, probably the share of new teams that invite a ' +
  'second member within seven days, and review it together at the next planning meeting with the ' +
  'whole group, including sales and support, so everyone agrees on what to try first and why it matters.';

/** Exactly 1,000 characters of English prose. */
export const LONG_PROSE_1000 = PROSE.slice(0, 1000);
if (LONG_PROSE_1000.length !== 1000) {
  throw new Error(`LONG_PROSE_1000 fixture must be 1000 characters, got ${LONG_PROSE_1000.length}`);
}

/** Realistic prose of a given length (repeats the paragraph as needed). */
export function prose(length: number): string {
  let text = '';
  while (text.length < length) text += `${PROSE} `;
  return text.slice(0, length);
}

/** Story 9: a 300-character English annotation (longer than one line of free text). */
export const ANNOTATION_300 = prose(300).trimEnd().padEnd(300, '.');
/** Story 9: a pasted paragraph one character over the text limit (TEXT_MAX_CHARS + 1). */
export const PASTE_5001 = prose(5001);
