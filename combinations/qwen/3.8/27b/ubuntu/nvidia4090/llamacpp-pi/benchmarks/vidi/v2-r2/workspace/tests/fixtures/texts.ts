/**
 * Realistic text fixtures for the sticky note e2e tests (story 2).
 * Long text must be English prose — never a single character repeated —
 * so line wrapping and auto-fit behave as they would for real content.
 */

/** A short phrase for quick typing. */
export const SHORT_PHRASE = 'Faster onboarding';

/** A realistic multi-line retro item (well under the limit). */
export const RETRO_ITEM =
  'We shipped the new onboarding flow.\n' +
  'Some users still got stuck at step 2.\n' +
  'Action: add a hint and track step 2 drop-off.';

/**
 * A 300-character single-line English annotation (story 9, TC-26): far
 * longer than TEXT_MAX_AUTO_WIDTH_WORLD at size M, so a typed text object
 * wraps into multiple lines at the 600-unit cap. Distinct words (no
 * repeated character runs), no newlines.
 */
export function longAnnotation(): string {
  return (
    'The sprint review ran long because the team wanted to celebrate the launch properly, and the '
    + 'facilitator kept adding one more topic while the afternoon light moved across the wall of '
    + 'sticky notes, turning the board into a map of everything the group had learned that quarter '
    + 'and the plan for the next'
  ).slice(0, 300);
}

/**
 * A 1,000-character paragraph of English prose, exactly at the sticky note
 * text limit. Distinct sentences (no repeated character runs).
 */
export function longParagraph(): string {
  const prose =
    'The whiteboard felt alive the moment the first idea landed on it as a sticky note, ' +
    'because every note could be grabbed, moved, and rearranged until the whole picture made sense. ' +
    'Teams used the yellow notes for facts, the pink ones for open questions, and the blue ones for decisions ' +
    'that needed to be remembered across weeks. Someone dragged the biggest cluster to the left to make room ' +
    'for the launch plan, and the notes simply followed the pointer without lag, no matter how far the board ' +
    'had been panned or how small the view had been zoomed. When the meeting ended, the board still held every ' +
    'thought exactly where it had been left, which made the next session feel like continuing a conversation ' +
    'instead of starting one. The only friction anyone noticed was how fast the notes filled up, because the ' +
    'best ideas apparently had a habit of arriving in long, winding sentences that refused to be summarised. ';
  let out = '';
  while (out.length < 1000) {
    out += prose;
  }
  return out.slice(0, 1000);
}
