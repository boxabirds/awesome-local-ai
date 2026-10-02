/**
 * Note text fixtures for tests. Realistic English prose: repeated single
 * characters lay out unrealistically, which matters for the font-fit e2e cases.
 */

import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

const PROSE =
  'The team agreed that onboarding new teammates takes far too long, because the ' +
  'setup guide lives in five different places and nobody knows which one is current. ' +
  'Deploys still happen by hand, so every release needs two people and a checklist, ' +
  'and twice last week the checklist was skipped under pressure. Customers notice the ' +
  'small delays most, especially the ones who import a large workbook on a Monday ' +
  'morning and wait for a spinner that never seems to end. We want one obvious place ' +
  'for notes, one command that ships the current build, and a dashboard that shows what ' +
  'broke before support tells us about it.';

const FILLER = ['so', 'we', 'aim', 'to', 'ship', 'it', 'now', 'and', 'then', 'test'];

/** English prose of exactly `target` characters (never repeated single characters). */
export function proseOfLength(target: number): string {
  const words = `${PROSE} ${PROSE}`.split(/\s+/).filter(Boolean);
  let out = '';
  for (const word of words) {
    if (out.length + word.length + 1 > target) break;
    out = out ? `${out} ${word}` : word;
  }
  let i = 0;
  while (out.length < target) {
    const word = FILLER[i % FILLER.length];
    if (out.length + 1 + word.length <= target) {
      out += ` ${word}`;
      i += 1;
    } else {
      out += ' '.repeat(target - out.length);
    }
  }
  return out.slice(0, target);
}

/** Short phrase fixture: a single word-sized idea. */
export const SHORT_TEXT = 'Faster onboarding';

/** One word fixture: text that always renders at the maximum font size. */
export const ONE_WORD = 'Onboarding';

/** Multi-line retrospective item, three lines, about 120 characters. */
export const RETRO_TEXT =
  'What slowed us down? Deploys by hand, every time.\n' +
  'The release checklist lives in a doc nobody owns.\n' +
  'Automate the pipeline first.';

/** 1,000 character paragraph used for the length limit and the overflow cases. */
export const LONG_TEXT_1000 = proseOfLength(STICKY_TEXT_MAX_CHARS);

/** One character past the limit. */
export const TEXT_1001 = proseOfLength(STICKY_TEXT_MAX_CHARS + 1);

/** A paste that is far over the limit. */
export const TEXT_1200 = proseOfLength(1200);
