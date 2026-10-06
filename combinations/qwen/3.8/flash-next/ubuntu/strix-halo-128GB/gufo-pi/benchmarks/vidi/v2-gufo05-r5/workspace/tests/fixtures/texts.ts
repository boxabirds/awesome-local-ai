/**
 * Note text fixtures. Realistic English prose: repeated single characters wrap in a way
 * no real note ever does, which would make the auto-fit tests meaningless.
 */

const SENTENCES: readonly string[] = [
  'The team agreed that onboarding is where most of the friction starts.',
  'New hires spend their first week looking for credentials instead of shipping.',
  'A shared checklist would cut the setup time down to a single afternoon.',
  'Documentation should live next to the code it describes, not in a graveyard.',
  'Pairing with a buddy for the first three days makes the tools feel smaller.',
  'Every unclear error message costs an hour of someone patient asking around.',
  'We should measure the time to first deploy and then defend it fiercely.',
  'Small wins shared in the retro keep the roadmap honest about effort.',
  'Owners rotate quarterly so the knowledge does not settle in one head.',
  'A fifteen minute walkthrough beats a hundred line readme every single time.',
];

/**
 * English prose of exactly `target` characters, built by joining whole sentences and
 * finishing on a word boundary (padded with spaces when the cut lands inside a word).
 */
export function proseOfLength(target: number, seed = 0): string {
  let text = '';
  let index = seed % SENTENCES.length;
  while (text.length < target) {
    index = (index + 1) % SENTENCES.length;
    const sentence = SENTENCES[index] as string;
    text += text.length === 0 ? sentence : ` ${sentence}`;
  }
  const cut = text.slice(0, target);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > target - 24 ? cut.slice(0, lastSpace) : cut;
  return head + ' '.repeat(Math.max(0, target - head.length));
}

/** A short idea, typed the way a user types it. */
export const SHORT_NOTE = 'Faster onboarding';

/** A multi-line retrospective item (three lines, about 120 characters). */
export const RETRO_ITEM =
  'Setup took two days.\nBuddy pairing fixed it fast.\nKeep a checklist in the repo.';

/** Exactly 1,000 characters: the longest note text the app stores. */
export const PROSE_1000 = proseOfLength(1000);

/** Exactly 1,200 characters: what a user pastes when they overshoot the limit. */
export const PROSE_1200 = proseOfLength(1200, 3);
