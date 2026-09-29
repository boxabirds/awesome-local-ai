/**
 * Realistic note-text fixtures for story 2 tests (unit + e2e).
 * The long text is real English prose (not repeated characters, which would
 * lay out unrealistically) of exactly STICKY_TEXT_MAX_CHARS characters.
 */
import { STICKY_TEXT_MAX_CHARS } from 'src/shared/config';

export const SHORT_TEXT = 'Faster onboarding';

/**
 * A realistic 300-character English annotation (story 9 TC-26): long enough
 * to exceed TEXT_MAX_AUTO_WIDTH_WORLD at every preset, short enough to type
 * quickly in e2e.
 */
export const LONG_ANNOTATION =
  'The release went out on Tuesday and the on-call channel stayed quiet all week, which the team treated as a small victory. The dashboard kept its green lights, the import job finished ahead of schedule, and the only incident was a flaky integration test that the platform team fixed by pinning the old';

export function assertLongAnnotationLength(): void {
  if (LONG_ANNOTATION.length !== 300) {
    throw new Error(`LONG_ANNOTATION fixture must be exactly 300 chars, got ${LONG_ANNOTATION.length}`);
  }
}

export const RETRO_TEXT = [
  'Daily sync keeps running long',
  'Agenda does not match the discussion',
  'Split into a written agenda and a short check-in',
].join('\n');

export const LONG_TEXT =
  "The team gathered around the board to sort the notes from last week's retrospective into themes. First came the items about onboarding: the new engineer felt lost in the first two days, the documentation was scattered across three repositories, and the invitation email arrived only after the first stand-up. Next were the notes about meetings, with several people writing that the daily sync had grown beyond twenty minutes and the agenda no longer matched what was discussed. A third group of notes covered the release process, because the last deployment had been rolled back twice in one afternoon and nobody had been sure who owned the rollout checklist. The facilitator moved each card closer to a heading as it was read aloud, and by the end of the hour the board showed three clear columns, a pile of duplicates that could be archived, and a handful of orange notes that needed a follow-up owner, a concrete date, and a set place in the very next sprint planning session, before Monday lunch.";

export function assertLongTextLength(): void {
  if (LONG_TEXT.length !== STICKY_TEXT_MAX_CHARS) {
    throw new Error(
      `LONG_TEXT fixture must be exactly ${STICKY_TEXT_MAX_CHARS} chars, got ${LONG_TEXT.length}`,
    );
  }
}

assertLongAnnotationLength();
