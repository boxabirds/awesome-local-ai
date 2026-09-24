/** Realistic note texts for tests (English prose, not repeated single characters). */

export const SHORT_PHRASE = 'Faster onboarding';

export const RETRO_ITEM = [
  'Went well: release train kept to schedule',
  'To improve: flaky checkout tests blocked two merges',
  'Action: pair on test isolation next sprint',
].join('\n');

const PROSE = [
  'Our retrospective kept circling back to the same theme: new starters take far too long to ship',
  'their first change. Laptops arrive late, access requests sit in a queue for days, and the setup',
  'guide assumes knowledge that nobody writes down. When a new engineer finally opens the codebase,',
  'the local environment needs three services, two secrets and a database snapshot that only one',
  'person knows how to refresh. We agreed that the first week should end with a small, real change',
  'in production, reviewed by a buddy who has blocked time in their calendar for exactly that.',
  'To get there we will replace the wiki page with a script that checks prerequisites, provisions',
  'accounts through the identity portal on the first morning, and seeds a sample dataset that is',
  'safe to share. Managers will order hardware as soon as an offer is signed rather than on the',
  'start date. We will measure time to first merged pull request for every new starter this quarter',
  'and review the numbers at the next retrospective, together with the notes each starter keeps',
  'about where they got stuck, so that the guide improves every time someone uses it. Several',
  'people also asked for a short recorded walkthrough of the architecture, since the diagrams in',
  'the repository are two years out of date and describe services we have already retired.',
].join(' ');

if (PROSE.length < 1200) throw new Error(`prose fixture too short: ${PROSE.length}`);

/** Exactly 1,000 characters of prose. */
export const PROSE_1000 = PROSE.slice(0, 1000);
/** Exactly 1,200 characters of prose (a paste over the limit). */
export const PROSE_1200 = PROSE.slice(0, 1200);
