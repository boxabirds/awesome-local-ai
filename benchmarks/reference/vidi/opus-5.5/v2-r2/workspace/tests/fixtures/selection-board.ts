// Story 7 fixture: a 20-note retro board in two clusters (top-left positions, world units).
// Cluster A is a tidy 3×2 grid; a lone note sits below it; cluster B overlaps in two rows.
import type { StickyColor } from '../../src/shared/config';

export interface SeedNote {
  x: number;
  y: number;
  text: string;
  color: StickyColor;
}

const CLUSTER_A_TEXTS = [
  'Went well: pairing on the release checklist',
  'Celebrate: zero incidents this sprint!',
  'Onboarding guide saved Maya two days',
  'Great customer call with Acme on Tuesday',
  'More async demos, fewer live ones',
  'Try a no-meeting Wednesday',
];

const CLUSTER_B_TEXTS = [
  'Improve: flaky end-to-end tests slow every merge down',
  'Standups run long — move details to threads',
  'Docs for the billing API are out of date',
  'Design review happened too late for the settings page',
  'Deploys take 40 minutes; can we cache the build?',
  'Pricing page confuses first-time visitors',
  'Mobile layout breaks when the keyboard is open',
  'Reduce support tickets about password resets',
  'Interview five churned users',
  'Accessibility audit of the checkout flow',
  'Research: offline editing at competitors',
  'Action: rotate the on-call buddy weekly',
  'Partner integrations',
];

/** Grid pitch of cluster A (200-unit notes, 20-unit gaps). */
export const CLUSTER_A_PITCH = 220;

export function retroBoard(): { clusterA: SeedNote[]; lone: SeedNote; clusterB: SeedNote[]; all: SeedNote[] } {
  const clusterA = CLUSTER_A_TEXTS.map((text, i) => ({
    x: (i % 3) * CLUSTER_A_PITCH,
    y: Math.floor(i / 3) * CLUSTER_A_PITCH,
    text,
    color: 'yellow' as const,
  }));
  const lone: SeedNote = { x: 220, y: 560, text: 'Parking lot: team offsite?', color: 'pink' };
  const clusterB = CLUSTER_B_TEXTS.map((text, i) => ({
    x: 1000 + (i % 7) * 150,
    y: Math.floor(i / 7) * 150,
    text,
    color: (i % 2 ? 'blue' : 'green') as StickyColor,
  }));
  return { clusterA, lone, clusterB, all: [...clusterA, lone, ...clusterB] };
}
