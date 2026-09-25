/**
 * Realistic text fixtures for story 2 tests (unit, component and e2e).
 * English prose on purpose — repeated single characters would lay out
 * unrealistically in font-fit tests.
 */

export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_ITEM =
  'What went well: the beta shipped two days early.\n' +
  "What didn't: on-call coverage was thin at launch.\n" +
  'Action: rotate on-call duty every two weeks.';

const LONG_PROSE_BASE =
  'The team gathered around the infinite board with a simple goal: to turn a messy ' +
  'afternoon of discussion into ideas anyone could see, move and remember. Each sticky ' +
  'note held one thought, a complaint about onboarding, a bet on a new feature, a ' +
  'reminder about the launch date. As the conversation moved, the notes moved with it. ' +
  'Colours separated the themes and position separated the priorities. By the end of the ' +
  'hour the board told the story of the meeting better than any minutes could, and the ' +
  'group agreed to keep it as the starting point for the next planning cycle, where ' +
  'every idea could still be rearranged until the right shape of the work emerged from ' +
  'the clutter of the first afternoon. Someone photographed the wall of colours for the ' +
  'retrospective, and the following week the same board opened the sprint review, each ' +
  'note a small promise waiting to be kept or quietly discarded as the work settled ' +
  'into its final arrangement before the standup turned to the next set of questions. '
  +
  'The team was ready for whatever came next on the board.';

// Padding words with (1 + length) costs of 4..7, which can fill any gap >= 4.
const PADDING_WORDS = ['pin', 'plan', 'idea', 'board', 'notes', 'sticky'];

/**
 * Returns exactly `target` characters of English prose. The base text is cut
 * at a word boundary at or before `target`, then topped up with short,
 * plausible words so the total is exactly `target`.
 */
function toExactLength(base: string, target: number): string {
  if (base.length < target) throw new Error('fixture base text too short');
  // Find a cut point: a space at an index such that the remaining gap is fillable.
  const fillable = (gap: number): boolean => gap === 0 || gap >= 4;
  let cut = -1;
  for (let i = target - 1; i >= 0; i -= 1) {
    if (base[i] === ' ' && fillable(target - i)) {
      cut = i;
      break;
    }
  }
  if (cut === -1) throw new Error('no suitable word boundary found');
  let text = base.slice(0, cut);
  const gap = target - text.length;
  if (gap === 0) return text;
  // Fill the gap: repeatedly take the largest padding word whose cost keeps
  // the remainder fillable (every remainder >= 4 is fillable, so this always
  // terminates exactly at 0).
  const costs = PADDING_WORDS.map(w => 1 + w.length); // [4, 5, 5, 6, 6, 7]
  let remaining = gap;
  while (remaining > 0) {
    let chosen = -1;
    for (let i = PADDING_WORDS.length - 1; i >= 0; i -= 1) {
      const c = costs[i];
      if (c <= remaining && (remaining - c === 0 || remaining - c >= 4)) {
        chosen = i;
        break;
      }
    }
    if (chosen === -1) throw new Error('fixture gap not fillable');
    text = `${text} ${PADDING_WORDS[chosen]}`;
    remaining -= costs[chosen];
  }
  if (text.length !== target) throw new Error(`fixture length ${text.length} != ${target}`);
  return text;
}

/** Exactly 1,000 characters of English prose (STICKY_TEXT_MAX_CHARS). */
export const LONG_PROSE = toExactLength(LONG_PROSE_BASE, 1000);
