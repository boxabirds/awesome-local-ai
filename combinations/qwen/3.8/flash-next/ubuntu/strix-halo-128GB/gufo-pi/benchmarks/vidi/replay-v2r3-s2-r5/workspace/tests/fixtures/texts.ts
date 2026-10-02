/** Realistic text fixtures for sticky note tests (not repeated single characters). */

export const SHORT_PHRASE = 'Faster onboarding';

/** Three-line retrospective item, ~120 characters. */
export const RETRO_ITEM =
  'What slowed us down this sprint?\n' +
  'Draft reviews sat in the queue for three days.\n' +
  'Nobody knew who owned the migration runbook.';

const SEED_PARAGRAPH =
  'The team met on Tuesday morning to talk about onboarding new customers. ' +
  'People arriving from a sales demo expect the product to look familiar, so the first ' +
  'hour should repeat the story they already heard, in the same words, with real data. ' +
  'When that hour is missing, adopters stall in the sandbox, invite nobody, and quietly ' +
  'stop coming back. Support tickets pile up around the same three questions every week, ' +
  'and each one is a sign that a screen we ship is asking for a decision the customer has ' +
  'not been given the context to make. Fixing the first hour is cheaper than hiring for ' +
  'the tickets, and it starts with writing down what the very first screen should say.';

/**
 * Builds English prose of exactly `target` characters by joining words from the
 * seed paragraph (wrapping around) and padding any leftover with spaces, so
 * layout tests use realistic word lengths.
 */
export function proseOfLength(target: number, seed: string = SEED_PARAGRAPH): string {
  if (target <= 0) return '';
  const words = seed.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; length < target; i += 1) {
    const word = words[i % words.length];
    const addition = parts.length === 0 ? word.length : word.length + 1;
    if (length + addition > target) break;
    parts.push(word);
    length += addition;
  }
  let text = parts.join(' ');
  if (text.length < target) text += ' '.repeat(target - text.length);
  if (text.length > target) text = text.slice(0, target);
  return text;
}

/** Exactly 1,000 characters (STICKY_TEXT_MAX_CHARS) of English prose. */
export const PROSE_1000 = proseOfLength(1000);

/** Exactly 1,200 characters, used for the "paste past the limit" case. */
export const PROSE_1200 = proseOfLength(1200);

/** Exactly `n` characters of prose, for boundary tests. */
export function proseOf(n: number): string {
  return proseOfLength(n);
}
