// Realistic sticky note texts (not repeated single characters, which lay out unrealistically).

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = 'Went well: pairing on the release checklist\nImprove: flaky end-to-end tests slow us down\nAction: rotate the on-call buddy weekly';

const PARAGRAPH =
  'Our quarterly planning session surfaced a recurring theme: new teammates take far too long to become productive. ' +
  'Several people described spending their first two weeks hunting for access requests, outdated setup guides and the ' +
  'one person who still remembers how the staging environment is wired together. We agreed that onboarding should feel ' +
  'like a guided path rather than a scavenger hunt. Proposed experiments include a single living checklist owned by the ' +
  'platform team, a buddy rotation so that every newcomer has a named contact for their first month, recorded walkthroughs ' +
  'of the main services, and a small starter project that touches the deployment pipeline end to end. We will measure ' +
  'success by the number of days until a first change reaches production and by a short survey at the end of week four. ' +
  'Open questions remain about who maintains the recordings, how we keep the checklist current when tools change, and ' +
  'whether remote hires need a different schedule. Next review in six weeks, with volunteers from each squad reporting ' +
  'back on what worked, what did not, and what surprised them along the way during the experiment.';

/** Prose cut to exactly `length` characters (repeats the paragraph when longer). */
export function prose(length: number): string {
  let text = PARAGRAPH;
  while (text.length < length) text += ` ${PARAGRAPH}`;
  return text.slice(0, length);
}

export const PROSE_1000 = prose(1000);
