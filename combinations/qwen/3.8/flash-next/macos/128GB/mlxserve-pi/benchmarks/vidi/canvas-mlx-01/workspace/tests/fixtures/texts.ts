/**
 * Realistic text fixtures shared by the sticky-note tests.
 *
 * The long fixture is English prose (not a run of repeated single characters, which
 * would lay out unrealistically for the font-fit checks) built deterministically to
 * exactly STICKY_TEXT_MAX_CHARS characters so the "text clips at the minimum size"
 * cases have a stable, realistic input.
 */
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/** A short phrase: the golden-path note text. */
export const SHORT_NOTE = 'Faster onboarding';

/** A three-line retrospective item (~120 characters). */
export const RETRO_ITEM =
  'Keep the daily demo short.\nRotate who drives the board.\nWrite one action per note.';

/** The base sentence the long fixture repeats. */
const PARAGRAPH_BASE =
  'Teams gather on the whiteboard to sketch an idea, move it beside related ideas, and ' +
  'colour it so themes stay visible as the conversation evolves. Sticky notes make that ' +
  'rhythm feel as natural as paper, and a long paragraph of realistic prose is the honest ' +
  'way to check that the text keeps fitting as it grows. When the last few words no longer ' +
  'fit at the smallest readable size the note quietly clips them behind a soft fade, so ' +
  'nothing is ever drawn outside the note and the board stays calm and legible for everyone ' +
  'sharing it. ';

/** Build English prose of exactly `max` characters (prose repeated, then trimmed and padded with words). */
export function proseOfLength(max: number): string {
  let s = '';
  while (s.length < max) s += PARAGRAPH_BASE;
  s = s.replace(/\s+$/, '');
  while (s.length < max) s += ' shared words';
  return s.slice(0, max);
}

/** Exactly STICKY_TEXT_MAX_CHARS characters of realistic English prose. */
export const PARAGRAPH_1000 = proseOfLength(STICKY_TEXT_MAX_CHARS);
