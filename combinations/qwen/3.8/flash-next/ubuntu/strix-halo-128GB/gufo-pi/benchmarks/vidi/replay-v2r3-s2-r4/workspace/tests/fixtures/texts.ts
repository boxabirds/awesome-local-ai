/** Realistic note text fixtures (not repeated single characters, which lay out unrealistically). */

export const SHORT_NOTE = 'Faster onboarding';

/** Multi-line retro item, 3 lines, ~120 characters. */
export const RETRO_ITEM = [
  'What slowed us down this sprint?',
  'Migrations needed a second review before ship',
  'Handoff between design and build was unclear',
].join('\n');

const SENTENCES = [
  'The team agreed that the onboarding flow needed a shorter path to the first successful action.',
  'Every new engineer should be able to run the board within five minutes of opening the laptop.',
  'We reviewed the feedback from last week and grouped the notes into four themes on the wall.',
  'Colour meant owner here, so nobody had to ask who was going to pick up the follow-up work.',
  'The retro showed that unclear handoffs cost more time than the migration itself ever did.',
  'Long paragraphs still have to stay readable inside a small square note, so text shrinks.',
  'A duplicate note is easy to remove, and an empty note is allowed to stay like blank paper.',
];

/** Realistic English prose of exactly `length` characters. */
export function prose(length: number): string {
  let out = '';
  let i = 0;
  while (out.length < length) {
    const sentence = SENTENCES[i % SENTENCES.length]!;
    out += out.length === 0 ? sentence : ' ' + sentence;
    i += 1;
  }
  return out.slice(0, length);
}

/** Exactly STICKY_TEXT_MAX_CHARS (1,000) characters of English prose. */
export const PROSE_1000 = prose(1000);

/** 1,200 characters, for the "paste 1,200 into an empty note" case. */
export const PROSE_1200 = prose(1200);
