/**
 * Fixed text fixtures shared by the component and e2e tests. The long ones are
 * realistic English prose (spaces included, cut at the character limit exactly
 * the way a clamped note is), because repeated single characters lay out
 * unrealistically and would hide font-fit behaviour.
 */

/** Under the character-counter threshold: no counter is shown for this. */
export const SHORT_NOTE_TEXT = 'Faster onboarding';

/** Three lines, about 120 characters: a realistic retro item. */
export const RETRO_NOTE_TEXT = [
  'Retro: keep the demo under five minutes.',
  'Pair the deploy notes with the person who wrote the change.',
  'Stop filing follow-ups nobody owns.',
].join('\n');

const SENTENCES = [
  'The board should feel like a wall you can keep adding notes to.',
  'Everyone in the room can put their idea down before the meeting ends.',
  'Drag a note next to another one and the grouping says something by itself.',
  'Colour is a cheap way to say these belong together, so make it fast.',
  'When a note runs out of room the text has to stay readable somehow.',
  'A short label is worth a paragraph here, so keep the writing tight.',
  'People abandon a tool the moment a click takes longer than a thought.',
  'The last thing anyone wants is to lose what they typed by accident.',
  'Notes that stack in a pile stop being useful after the first five.',
  'Write one idea per note and the ordering becomes the discussion.',
];

/**
 * English prose of exactly `length` characters: sentences are laid end to end
 * and the text is cut at exactly `length`, which is what a note clamped at the
 * character limit looks like (the final word may be truncated).
 */
export function proseOfLength(length: number): string {
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; total < length; i += 1) {
    const sentence = SENTENCES[i % SENTENCES.length]!;
    parts.push(sentence);
    total += parts.length === 1 ? sentence.length : sentence.length + 1;
  }
  return parts.join(' ').slice(0, length);
}

/**
 * Long enough that even the smallest allowed font cannot fit it: the note has
 * to overflow, show the fade and count characters.
 */
export const LONG_PROSE = proseOfLength(760);
/** Exactly the sticky note's character limit: 1,000 characters of prose. */
export const TEXT_1000 = proseOfLength(1_000);

/** Well past the limit; typing this must leave exactly the first 1,000. */
export const TEXT_1200 = proseOfLength(1_200);
