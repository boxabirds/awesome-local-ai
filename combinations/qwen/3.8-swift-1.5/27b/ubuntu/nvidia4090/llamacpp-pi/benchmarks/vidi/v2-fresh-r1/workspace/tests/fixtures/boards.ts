// Test fixtures: realistic board generators using real board-model functions.
// Produces real Yjs update bytes.

import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  moveObject,
  setStickyColor,
  getStickyText,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const PHRASES = [
  'What did we do well?',
  'What could be better?',
  'Action items for next sprint',
  'User research findings from last week',
  'The onboarding flow needs a redesign',
  'Performance is great on mobile now',
  'We should test the dark mode theme',
  'API rate limiting is causing issues',
  'The new dashboard looks fantastic',
  'Need to fix the login timeout bug',
  'Customer feedback: love the new feature',
  'Database migrations went smoothly',
  'The search results are too slow',
  'Accessibility audit findings attached',
  'Deployment pipeline is now 2x faster',
  'We need better error messages',
  'The mobile app crashes on iOS 17',
  'Team velocity increased by 20%',
  'Stakeholder meeting notes from Tuesday',
  'The payment gateway integration is done',
  'We should add unit tests for the parser',
  'The CI pipeline fails on flaky network tests',
  'New team member started this Monday',
  'The cache invalidation strategy needs work',
  'User session management is leaking memory',
];

/**
 * Generate a 25-note retro board with mixed colours, multi-line texts,
 * and overlapping stacking. Returns the doc and the list of note ids.
 */
export function makeRetroBoard(): { doc: Y.Doc; noteIds: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const noteIds: string[] = [];

  for (let i = 0; i < 25; i++) {
    const x = 100 + (i % 5) * 220 + (i % 3) * 15;
    const y = 100 + Math.floor(i / 5) * 220 + (i % 2) * 20;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);

    // Multi-line text for some notes.
    const text = PHRASES[i % PHRASES.length];
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.insert(0, text);
      if (i % 3 === 0) {
        ytext.insert(ytext.length, '\nMore detail here.');
      }
    }
    noteIds.push(id);
  }

  return { doc, noteIds };
}

/**
 * Generate a board with `count` notes with realistic English phrases
 * (10–300 chars) laid out in clusters.
 */
export function makeLargeBoard(count: number): { doc: Y.Doc; noteIds: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const noteIds: string[] = [];

  const clusterSize = 20;
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(i / clusterSize);
    const inCluster = i % clusterSize;
    const cx = 500 + cluster * 1000;
    const cy = 500 + Math.floor(cluster / 3) * 800;
    const x = cx + (inCluster % 5) * 220;
    const y = cy + Math.floor(inCluster / 5) * 220;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);

    // Realistic text: 100–300 chars (long enough to exceed chunk size with 2000 notes).
    const base = PHRASES[i % PHRASES.length];
    let text = base;
    while (text.length < 200) text += ' Additional context and details for this note item.';
    if (text.length > 300) text = text.slice(0, 300);
    const ytext = getStickyText(doc, id);
    if (ytext) ytext.insert(0, text);

    noteIds.push(id);
  }

  return { doc, noteIds };
}

/**
 * Encode a doc as a Yjs update (the bytes that would be stored).
 */
export function docToBytes(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Create a damaged update by truncating the last 10 bytes.
 */
export function damagedUpdate(update: Uint8Array): Uint8Array {
  if (update.length <= 10) return new Uint8Array([0xff, 0xff]);
  return update.subarray(0, update.length - 10);
}

/**
 * Create random bytes of the same length as the input.
 */
export function randomBytesOfLength(len: number): Uint8Array {
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) result[i] = Math.floor(Math.random() * 256);
  return result;
}
