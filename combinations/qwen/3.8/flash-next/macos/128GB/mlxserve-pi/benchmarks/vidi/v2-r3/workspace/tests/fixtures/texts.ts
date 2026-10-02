// Realistic note-text fixtures (design "Fixtures"): a short phrase, a
// three-line retrospective item and a 1,000 character English paragraph.
// Prose — not repeated single characters — so e2e text layout is realistic.
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

/** Short note text (PRD golden path). */
export const SHORT_NOTE = 'Faster onboarding';

/** A multi-line retrospective item: 3 lines, ~120 characters. */
export const RETRO_ITEM = [
  'What went well this sprint:',
  'we shipped the whole export path in a single week,',
  'but the docs lagged well behind the code and nobody reviewed it',
].join('\n');

const PROSE = [
  'Teams gather on the whiteboard to turn scattered thoughts into a shared plan, and the fastest',
  'way to capture a thought is a sticky note. A note that is easy to move invites regrouping,',
  'because thinking evolves as the conversation moves on and an idea that once stood alone',
  'suddenly belongs beside two others. Colour is the cheapest structure available: a green note',
  'can mean an action, a red one a risk, and a blue one a question that nobody has answered yet.',
  'When the room falls silent someone reads the board aloud, top to bottom, and the order of the',
  'notes quietly shapes what the team decides to do next. Long notes teach patience, because text',
  'that no longer fits must fade away inside the note rather than spill across the board and hide',
  'the work of a neighbour; the team learns to split a paragraph into three smaller cards, to',
  'circle the ones that matter with a marker, and to photograph the finished board before the',
  'room resets itself for the very next group of strangers who will arrive, sit down, and start',
  'sticking paper to the walls all over again with such serious and cheerful confidence that',
  'everyone forgets the afternoon was supposed to end early, and stays a few minutes longer to',
  'move one last note into the middle of the board where everybody can see it clearly.',
].join(' ');

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of English prose. */
export const LONG_NOTE_1000 = PROSE.slice(0, STICKY_TEXT_MAX_CHARS);

/** 1,200 characters: what a too-long paste is cut down from (sticky.text_limit). */
export const PASTE_1200 = `${LONG_NOTE_1000} ${PROSE.slice(STICKY_TEXT_MAX_CHARS - 200)}`.slice(0, 1200);

/**
 * 300 characters of prose, cut at a word boundary: long enough that it cannot be
 * one line of text at any size, which is what the long-annotation case is about
 * (text.free_width). Shorter than the sticky note's paragraph, because free text
 * is what somebody writes in a moment, not an essay.
 */
export const ANNOTATION_300 = PROSE.slice(0, 300).replace(/\s\S*$/, '');
