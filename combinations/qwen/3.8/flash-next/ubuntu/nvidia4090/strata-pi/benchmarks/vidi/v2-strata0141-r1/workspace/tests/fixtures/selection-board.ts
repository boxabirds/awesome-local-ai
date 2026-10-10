import { STICKY_COLOR_NAMES, type StickyColor } from '../../src/shared/config';

/**
 * The story 7 e2e fixture (`sel.interaction`, `sel.marquee_ui`): a 20-note retro
 * board in two clusters - ten notes on top, ten below, with the bottom-right
 * cluster nudged into its neighbour so stacking order matters.
 *
 * Positions are world units and are the note **centres**, which is what
 * `createSticky` and the test-only `createNote` hook take.
 */
export interface FixtureNote {
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
}

const PHRASES: readonly string[] = [
  'Ship the retro board',
  'Faster onboarding',
  'Too many meetings',
  'Selection is a group tool',
  'Keyboard beats the mouse',
  'Box select beats one by one',
  'Move a dozen at once',
  'Resize without breaking ranks',
  'Delete the whole cluster',
  'Undo should be one step',
  'Nobody loses work',
  'Prune what vanished',
  'Badges tell the truth',
  'Reconnect quietly',
  'Sharing is a link',
  'Boards outlive reloads',
  'Notes keep their text',
  'Colours carry meaning',
  'Comments need owners',
  'Export as an image',
];

const COLUMNS = 5;
const ROWS = 4;

/** Two clusters of ten: the lower one is nudged sideways in its right half. */
export const FIXTURE_NOTES: readonly FixtureNote[] = Array.from(
  { length: COLUMNS * ROWS },
  (_, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const inLowerCluster = row >= 2;
    const nudge = inLowerCluster && column >= 3 && index % 2 === 0 ? 60 : 0;
    return {
      x: 150 + column * 300 + nudge,
      y: 150 + row * 300,
      color: STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length]!,
      text: PHRASES[index % PHRASES.length]!,
    };
  },
);

export const FIXTURE_COLUMNS = COLUMNS;
export const FIXTURE_ROWS = ROWS;
