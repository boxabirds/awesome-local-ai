/**
 * Text fixtures for the story 2 tests. Realistic English prose, because note text layout
 * (font fit, overflow) depends on how words break: a run of repeated characters wraps
 * nothing and would make the auto-fit tests pass for the wrong reason.
 */

/** The length a note's text is limited to (mirrors STICKY_TEXT_MAX_CHARS). */
export const STICKY_LIMIT = 1_000;

/** The PRD golden-path note. */
export const SHORT_PHRASE = 'Faster onboarding';

/** A three-line retro item (~120 characters) with the shape of a real sticky note. */
export const RETRO_ITEM = [
  'Handover between shifts misses the',
  'open tickets, so the next team redoes',
  'work that was already finished.',
].join('\n');

/** Exactly 1,000 characters of English prose: the text limit (STICKY_TEXT_MAX_CHARS). */
export const LONG_PROSE = `Faster onboarding saves every new teammate an afternoon of guesswork. Notes should cluster by theme so the team can see the shape of the problem. We keep hitting the same three blockers in the handover between shifts. Rename the board after the retro so nobody loses their notes on reload. A short phrase is easier to move than a paragraph, so keep it to one idea. Colour separates who owns an idea from how urgent that idea feels. Double click the empty space and start typing before the thought escapes. The board stays where we left it, even when the window changes size. Six colours are enough for a first pass, because the group decides anyway. Faster onboarding saves every new teammate an afternoon of guesswork. Notes should cluster by theme so the team can see the shape of the problem. We keep hitting the same three blockers in the handover between shifts. Rename the board after the retro so nobody loses their notes on reload. A short phrase is easier to move than a paragraph, so keep a`;

/** Repeat `base` until it reaches exactly `target` characters. */
export function textOfLength(base: string, target: number): string {
  if (target <= 0) {
    return '';
  }
  let out = base;
  while (out.length < target) {
    out = `${out} ${base}`;
  }
  return out.slice(0, target);
}

/** Exactly `target` characters of prose; the fixtures for the length-limit tests. */
export function proseOfLength(target: number): string {
  return textOfLength(LONG_PROSE, target);
}

/** 1,200 characters: pasting this into an empty note keeps the first 1,000 (TC-14). */
export const PASTE_OVER_LIMIT = proseOfLength(1_200);
