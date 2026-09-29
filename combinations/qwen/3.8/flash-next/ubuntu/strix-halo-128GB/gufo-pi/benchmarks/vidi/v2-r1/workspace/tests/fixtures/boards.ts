/**
 * Board fixtures: generate realistic board content using the real board-model
 * functions, so the bytes produced are real Yjs updates.
 */

import * as Y from 'yjs';

import {
  initDoc,
  createSticky,
  moveObject,
  getStickyText,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, type StickyColor } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const RETRO_PHRASES = [
  'Ship the demo weekly.',
  'Owners write the follow-ups down.',
  'We stop restarting meetings that have no decisions.',
  'More pairing on complex stories.',
  'Reduce WIP limit to three.',
  'The build should not break on Fridays.',
  'Need clearer acceptance criteria upfront.',
  'Celebrate small wins in standup.',
  'Less meetings, more maker time.',
  'Improve onboarding docs for new hires.',
  'Cross-team sync every other week.',
  'Let us try mob programming on bugs.',
  'Automate the deploy checklist.',
  'The staging environment is too slow.',
  'Write retro action items as tickets.',
  'Rotate the release manager role.',
  'Keep stories smaller than two days.',
  'More context switching hurts quality.',
  'Pair review speeds up feedback loops.',
  'Spike unknown tech before committing.',
  'Fix flaky tests before adding features.',
  'Share learnings in a weekly demo.',
  'Use feature flags for risky changes.',
  'Document decisions in ADRs.',
  'Reduce manual regression testing burden.',
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Create a 25-note retro board with mixed colours, multi-line text, and overlaps.
 * Returns a Y.Doc with the content.
 */
export function create25NoteBoard(seed = 42): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const rand = seededRandom(seed);

  for (let i = 0; i < 25; i++) {
    const color = COLORS[i % COLORS.length];
    const x = Math.floor(rand() * 2000) - 500;
    const y = Math.floor(rand() * 1500) - 300;
    const id = createSticky(doc, { x, y }, color);
    if (id) {
      const text = RETRO_PHRASES[i % RETRO_PHRASES.length];
      const ytext = getStickyText(doc, id);
      if (ytext) ytext.insert(0, text);
    }
  }

  // Overlap some notes deliberately
  const objects = doc.getMap('objects');
  const ids = [...objects.keys()];
  if (ids.length >= 5) {
    const source = objects.get(ids[0]) as Y.Map<unknown>;
    moveObject(doc, ids[3], (source.get('x') as number) + 20, (source.get('y') as number) + 20);
  }

  return doc;
}

/**
 * Create a board with PERSIST_TESTED_NOTES notes, realistic English phrases
 * of 10-300 chars, laid out in clusters.
 */
export function createLargeBoard(noteCount = PERSIST_TESTED_NOTES, seed = 123): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const rand = seededRandom(seed);

  const LONG_PHRASE = 'The quick brown fox jumps over the lazy dog while the cat watches from the windowsill and the birds sing their morning songs outside the garden gate where flowers bloom in every colour imaginable during the warm spring days that follow the long cold winter months of patience and quiet reflection on what matters most in life and work and the people we share it with every single day we are given on this beautiful planet we call home where dreams can come true if you believe in them strongly enough and work hard every day to make them happen no matter how impossible they seem at first glance';

  const clusterSize = 10;
  for (let i = 0; i < noteCount; i++) {
    const cluster = Math.floor(i / clusterSize);
    const inCluster = i % clusterSize;
    const clusterX = (cluster % 20) * 1500;
    const clusterY = Math.floor(cluster / 20) * 1200;
    const x = clusterX + (inCluster % 4) * 250 + Math.floor(rand() * 50);
    const y = clusterY + Math.floor(inCluster / 4) * 250 + Math.floor(rand() * 50);
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    const id = createSticky(doc, { x, y }, color);
    if (id) {
      const len = 10 + Math.floor(rand() * 290);
      const text = LONG_PHRASE.slice(0, len);
      const ytext = getStickyText(doc, id);
      if (ytext) ytext.insert(0, text);
    }
  }

  return doc;
}

/**
 * Produce damaged bytes: take a valid update and truncate its last 10 bytes.
 */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  if (update.byteLength <= 10) return new Uint8Array(1);
  return update.slice(0, update.byteLength - 10);
}

/**
 * Produce damaged bytes: random bytes of the same length as a valid update.
 */
export function randomBytesOfLength(length: number, seed = 99): Uint8Array {
  const rand = seededRandom(seed);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}
