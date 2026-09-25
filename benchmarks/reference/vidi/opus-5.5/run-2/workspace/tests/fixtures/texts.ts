/** Realistic sticky note texts (design Fixtures). */
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = 'Went well: pairing on the release\nImprove: flaky checkout tests\nAction: Priya to own test triage';

const PROSE =
  'Our retrospective kept circling back to the same theme: new team members take far too long to become productive. ' +
  'In the first week they wrestle with access requests, outdated setup guides and a local environment that only works on one laptop model. ' +
  'By the second week they are shadowing others, but nobody has written down which parts of the system matter most, so every conversation starts from scratch. ' +
  'We agreed to try three things before the next review. First, a single page that lists every account and permission a newcomer needs, with the owner of each. ' +
  'Second, a scripted development setup that we run on a clean machine every Friday so it never drifts. ' +
  'Third, a buddy rota, so that each new person has one named colleague who answers questions without making them feel like a burden. ' +
  'We will measure the time from first day to first merged change and compare it with the last four hires, then decide whether to keep going. ' +
  'If the numbers improve we will write the approach into the team handbook and share it with the other squads in the department.';

/** Builds English prose of exactly `length` characters (repeating the paragraph if needed). */
export function proseOfLength(length: number): string {
  let out = '';
  while (out.length < length) out += (out.length > 0 ? ' ' : '') + PROSE;
  return out.slice(0, length);
}

/** A 1,000 character paragraph of English prose. */
export const LONG_PARAGRAPH = proseOfLength(STICKY_TEXT_MAX_CHARS);
