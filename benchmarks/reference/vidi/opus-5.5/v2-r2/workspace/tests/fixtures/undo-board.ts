// Story 8 fixture: a 12-note retro board in varied colours and sizes (top-left positions, world units).
// Eight notes form one cluster (the accidental-delete scenario); four sit far to the right.
import type { StickyColor } from '../../src/shared/config';

export interface UndoSeedNote {
  x: number;
  y: number;
  text: string;
  color: StickyColor;
  size: number;
}

const CLUSTER_TEXTS = [
  'Went well: release checklist',
  'Celebrate: zero incidents',
  'Onboarding guide helped',
  'Great call with Acme',
  'More async demos',
  'No-meeting Wednesday?',
  'Flaky tests slow merges',
  'Standups run long',
];
const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
const SIZES = [200, 160, 180, 200, 150, 190, 170, 200];

/** Grid pitch of the cluster (notes are at most 200 units, so they never overlap). */
export const CLUSTER_PITCH = 220;

export function undoRetroBoard(): { cluster: UndoSeedNote[]; others: UndoSeedNote[]; all: UndoSeedNote[] } {
  const cluster = CLUSTER_TEXTS.map((text, i) => ({
    x: (i % 4) * CLUSTER_PITCH,
    y: Math.floor(i / 4) * CLUSTER_PITCH,
    text,
    color: COLORS[i % COLORS.length]!,
    size: SIZES[i]!,
  }));
  const others = ['Action: rotate on-call', 'Docs out of date', 'Interview churned users', 'Parking lot: offsite'].map(
    (text, i) => ({ x: 1400 + (i % 2) * 300, y: Math.floor(i / 2) * 300, text, color: COLORS[(i + 2) % COLORS.length]!, size: 200 - i * 20 }),
  );
  return { cluster, others, all: [...cluster, ...others] };
}
