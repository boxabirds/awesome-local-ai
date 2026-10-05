/**
 * Realistic note-text fixtures (design: "short phrase, 3-line retro item,
 * 1,000-character English paragraph"). Repeated single characters lay out
 * unrealistically, so prose is used for the long cases.
 */

/** Short phrase. */
export const SHORT_PHRASE = "Faster onboarding";

/** Multi-line retrospective item (3 lines, ~120 characters). */
export const RETRO_ITEM =
  "What went well:\n" +
  "We shipped the onboarding rewrite two days early and the whole team paired on it.\n" +
  "What to improve: keep the retro notes short enough to read at a glance.";

/** Exactly 1,000 characters of English prose. */
export const PROSE_1000 = buildProse(1000);

/** 1,200 characters: the paste that has to be cut at the limit. */
export const PROSE_1200 = buildProse(1200);

/**
 * Builds `length` characters of varied English prose. Sentences are drawn from
 * a fixed pool so the text is deterministic and lays out like real writing
 * (mixed word lengths, punctuation, spaces).
 */
export function buildProse(length: number): string {
  const sentences = [
    "The team agreed that the first draft was too detailed for a quick review. ",
    "Notes written in colour help people see which themes belong together. ",
    "A short phrase on a card is easier to move than a long paragraph. ",
    "During the retrospective we grouped the cards by the week they came from. ",
    "Everyone could read the board clearly once the text stopped overflowing. ",
    "We kept the duplicates and deleted only the cards that said nothing new. ",
    "Moving a card next to a related idea is the fastest way to build a theme. ",
    "The facilitator asked each person to write three ideas before any discussion. ",
  ];

  let text = "";
  for (let i = 0; text.length < length; i += 1) {
    text += sentences[i % sentences.length];
  }
  // Cut at a word boundary and re-pad with single spaces so the result is
  // exactly `length` characters of readable prose.
  const clipped = text.slice(0, length);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return base.padEnd(length, " ");
}
