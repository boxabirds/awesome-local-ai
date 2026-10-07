/**
 * Realistic text fixtures for story 2 tests.
 *
 * The design asks for real English prose rather than repeated single
 * characters, because text layout (wrapping, font fit) depends on word
 * lengths and spaces.
 */

/** Short note (max font size). */
export const SHORT_TEXT = "Faster onboarding";

/** A multi-line retro item: 3 lines, ~120 characters. */
export const RETRO_TEXT = [
  "What worked: pairing on the tricky migration kept bugs small",
  "What hurt: the deploy queue silently dropped two releases",
  "Next: write the runbook before the next freeze window opens",
].join("\n");

const WORDS = [
  "the", "team", "agreed", "that", "onboarding", "is", "hardest", "when", "people", "learn",
  "in", "silence", "so", "we", "wrote", "down", "every", "question", "and", "answered", "it",
  "on", "a", "shared", "board", "notes", "grouped", "by", "theme", "made", "the", "review",
  "short", "clear", "decisions", "came", "out", "of", "it", "within", "one", "hour", "which",
  "felt", "remarkably", "quick", "compared", "with", "last", "quarter", "when", "the", "same",
  "discussion", "took", "three", "meetings", "and", "still", "ended", "without", "agreement",
  "colour", "helped", "because", "anyone", "could", "see", "which", "ideas", "belonged", "to",
  "ownership", "and", "which", "were", "only", "open", "questions", "waiting", "for", "someone",
  "to", "pick", "them", "up", "later", "in", "the", "week", "that", "is", "why", "we", "keep",
  "the", "board", "simple", "enough", "to", "read", "from", "across", "the", "room",
];

/**
 * Build English prose of exactly `length` characters: whole words from the
 * bank, and when the remaining gap is too small for the next word the closest
 * word that fits exactly is used.
 */
export function proseFixture(length: number): string {
  if (length <= 0) return "";
  const parts: string[] = [];
  let used = 0;

  for (let i = 0; ; i += 1) {
    const word = WORDS[i % WORDS.length]!;
    const gap = parts.length > 0 ? 1 : 0;
    const remaining = length - used - gap;

    if (remaining <= 0) break;
    if (word.length <= remaining) {
      parts.push(word);
      used += gap + word.length;
      if (used === length) break;
      continue;
    }

    // The next word does not fit: find one whose length fills the gap exactly.
    const exact = WORDS.find((candidate) => candidate.length === remaining);
    if (exact) {
      parts.push(exact);
      used = length;
      break;
    }
    parts.push(word.slice(0, remaining));
    used = length;
    break;
  }

  return parts.join(" ").slice(0, length);
}

/** A 1,000 character paragraph (the note text limit). */
export const PROSE_1000 = proseFixture(1000);

/** 1,200 characters, used for the paste-overflow case. */
export const PROSE_1200 = proseFixture(1200);
