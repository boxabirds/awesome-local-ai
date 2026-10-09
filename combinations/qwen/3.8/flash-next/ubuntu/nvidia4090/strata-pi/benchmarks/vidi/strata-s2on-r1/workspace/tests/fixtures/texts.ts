/**
 * Story 2 text fixtures.
 *
 * Realistic English prose rather than repeated characters: font fitting and
 * clipping depend on how words actually wrap, so "x".repeat(1000) would test a
 * layout no real note ever has.
 */

export const SHORT_PHRASE = "Faster onboarding";

/** A multi-line retrospective item: 3 lines, ~120 characters. */
export const RETRO_ITEM = [
  "Kept the daily sync to fifteen minutes and everyone stayed on topic.",
  "Pairing on the migration removed two days of guesswork.",
  "Parking lot notes were never revisited, so the same question came back twice.",
].join("\n");

const PROSE_SENTENCES = [
  "The team agreed that the first version of the onboarding guide was too long to read in one sitting.",
  "Several people said they stopped after the second page because nothing told them what to do next.",
  "A shorter checklist with links to the deeper documents tested better with new hires last quarter.",
  "We kept the examples close to the instructions so nobody had to search for the part that mattered.",
  "The retro showed that written updates reached more people than the standing meeting ever did.",
  "Two engineers volunteered to rewrite the walkthrough and share it with the support group on Friday.",
  "Someone suggested colour coding the steps so that the optional material was obviously optional.",
  "The plan is to publish the first draft, watch where readers drop off, and then cut the weakest section.",
  "Documentation that answers a question in one screen beats documentation that answers every question.",
  "After the change, the average ticket closed faster and fewer people asked for a live demonstration.",
  "The next step is to repeat the study with the international team and compare where they stall.",
  "Everyone agreed to keep the notes small enough that a single card can be read in a few seconds.",
  "A short written summary after each session gave the people who were absent a fair chance to catch up.",
  "The support group asked for one clear owner for every question that stayed open longer than a week.",
];

/** Continuous English prose, well over the note limit. */
export const PROSE_SOURCE = PROSE_SENTENCES.join(" ");

function slice(text: string, length: number): string {
  if (text.length < length) {
    throw new Error(`fixture is ${text.length} characters, need at least ${length}`);
  }
  return text.slice(0, length);
}

/** Exactly 1,000 characters of prose (the longest a note can hold). */
export const PROSE_1000 = slice(PROSE_SOURCE, 1000);

/** Exactly 1,200 characters: the over-limit paste case. */
export const PROSE_1200 = slice(PROSE_SOURCE, 1200);

/** 949 / 950 / 951 character variants for the counter threshold boundaries. */
export const proseOfLength = (length: number): string => slice(PROSE_SOURCE, length);
