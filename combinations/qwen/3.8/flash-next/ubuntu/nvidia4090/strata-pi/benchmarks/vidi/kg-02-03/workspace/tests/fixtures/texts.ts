/**
 * Realistic note text fixtures (story 2).
 *
 * The long fixture is genuine English prose, not a run of repeated characters:
 * repeated characters lay out unrealistically narrow, which would hide text
 * fit and overflow bugs.
 */

/** Short phrase (PRD golden path). */
export const SHORT_NOTE_TEXT = "Faster onboarding";

/** Multi-line retrospective item: 3 lines, about 120 characters. */
export const RETRO_ITEM_TEXT = [
  "Keep the Friday demo, but start it earlier",
  "so remote teammates can join before lunch",
  "Rotate the note taker every sprint",
].join("\n");

const SENTENCES = [
  "The team agreed that a short daily check in keeps the board tidy",
  "Everyone wrote one idea per note so grouping stayed easy later",
  "Colour groups marked who owned the follow up work",
  "Dupes were deleted as soon as they were spotted",
  "Long titles were split into two smaller notes instead",
  "The retro board stayed open for the whole sprint",
  "New people found the board from the shared link",
  "Notes that nobody touched were moved to a parking lot column",
  "The facilitator timed each round to keep the pace fair",
  "Action items were copied into the tracker after voting",
];

/** Running English prose, long enough to cut to any fixture length. */
const PROSE = Array.from({ length: 8 }, (_, round) =>
  SENTENCES.map((sentence) => `${sentence}${round % 2 === 0 ? "." : "."}`).join(" "),
).join(" ");

/**
 * Builds English prose of exactly `target` characters. The cut can land inside
 * a word, which is exactly what pasting a long blob looks like.
 */
function proseOfLength(target: number): string {
  if (target <= 0) return "";
  let text = PROSE;
  while (text.length < target) text = `${text} ${PROSE}`;
  return text.slice(0, target);
}

/** Exactly 1,000 characters of English prose. */
export const LONG_NOTE_TEXT_1000 = proseOfLength(1000);

/** 1,200 characters: the pasting fixture that must be cut at 1,000. */
export const PASTE_TEXT_1200 = proseOfLength(1200);

/** Text of an exact length, built from realistic prose. */
export function textOfLength(target: number): string {
  if (target === LONG_NOTE_TEXT_1000.length) return LONG_NOTE_TEXT_1000;
  if (target === PASTE_TEXT_1200.length) return PASTE_TEXT_1200;
  const base = proseOfLength(target);
  return base.length > target ? base.slice(0, target) : base;
}

/** 900 characters: more than 50 below the limit, so the counter must stay hidden. */
export const TEXT_900 = textOfLength(900);

/** 960 characters: within 50 of the limit, so the character counter must show. */
export const TEXT_960 = textOfLength(960);

/** A repeated word appended to `SHORT_NOTE_TEXT`: it must land exactly once. */
export const REPEATED_WORD_TEXT = " onboarding";

/** A note being edited with an IME: latin text with kana appended. */
export const IME_COMPOSITION_SEQUENCE = `${SHORT_NOTE_TEXT}アイデア`;

/** Text with characters outside the BMP (emoji are surrogate pairs). */
export const EMOJI_TEXT = `${SHORT_NOTE_TEXT} 🎯🧠✅`;
