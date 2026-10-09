// Realistic board generators for persistence tests (design: Fixtures).
// Everything is built with the real board-model functions so the captured
// updates are real Yjs updates; texts are realistic English phrases.

import * as Y from 'yjs';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

export interface GeneratedBoard {
  // Yjs updates in apply order: index 0 is initDoc, then one per note
  // creation, then the styling updates.
  updates: Uint8Array[];
  // Final board state of the generated document.
  board: readonly StickySnapshot[];
}

function startCapture(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) updates.push(update.slice());
  });
  return updates;
}

// mulberry32: deterministic PRNG so every run generates the same boards.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  'release deploy notes backlog sprint owner review design test build ' +
  'document ticket onboarding pipeline feature fix idea plan retro coffee ' +
  'column cluster theme vote action followup summary changelog handoff'
    .split(' ');

function phrase(rand: () => number): string {
  const target = 150 + Math.floor(rand() * 151); // 150..300 characters
  const parts: string[] = [];
  let length = 0;
  while (length < target) {
    const word = WORDS[Math.floor(rand() * WORDS.length)];
    parts.push(word);
    length += word.length + 1;
  }
  const text = parts.join(' ');
  const capitalised = text.charAt(0).toUpperCase() + text.slice(1);
  return capitalised.length > 300 ? capitalised.slice(0, 300) : capitalised;
}

const RETRO_LINES = [
  'Release notes arrived two days late',
  'automate publishing with the build tag',
  'half the team answered tickets from memory',
  'pair onboarding with a buddy rotation',
  'pipeline flakes blocked the demo twice',
  'quarantine the flaky suite and fix forward',
  'documentation debt grew by thirty percent',
  'schedule a docs hour every friday',
  'design review started slipping to monday',
  'book review slots when the work is planned',
  'the retro board itself needs a board',
  'move action items to tracked tickets now',
  'coffee budget ran out before sprint end',
  'shared calendar for handoffs across zones',
  'changelog template cut writing time down',
  'test data refresh is fully manual today',
  'one owner per fix with a named backup',
  'feature flags outlived the features',
  'delete dead flags during the cleanup hour',
  'onboarding checklist drifted from reality',
  'the new joiner fixed three typos day one',
  'support macros and notes finally match',
  'build cache made CI twice as fast',
  'keep the fast lane for urgent fixes only',
  'planning hour is the best hour of the week',
];

// 25-note retrospective board: mixed colours, multi-line texts, overlapping
// grid layout with intentional stacking. Creation updates occupy indices
// 1..25 so a test can damage a known note-creation row.
export function generateRetroBoard(): GeneratedBoard {
  const doc = new Y.Doc();
  const updates = startCapture(doc);
  initDoc(doc);
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 160 + 200; // 160 < note size 200: neighbours overlap
    const y = Math.floor(i / 5) * 160 + 200;
    const id = createSticky(doc, { x, y }, colors[i % colors.length]);
    if (typeof id === 'string') ids.push(id);
  }
  ids.forEach((id, i) => {
    const text = getStickyText(doc, id);
    if (text) {
      doc.transact(() => {
        text.insert(0, `${RETRO_LINES[i]}\n${RETRO_LINES[(i + 1) % 25]}`);
      }, LOCAL_ORIGIN);
    }
    if (i % 4 === 0) setStickyColor(doc, id, colors[(i + 2) % colors.length]);
    if (i % 3 === 0) moveObject(doc, id, 180 + i * 8, 180 + i * 6);
    if (i % 7 === 0) bringToFront(doc, id);
  });
  return { updates, board: snapshot(doc) };
}

// Board of `PERSIST_TESTED_NOTES` notes with realistic 10-300 character
// phrases laid out in clusters, generated deterministically.
export function generateLargeBoard(noteCount: number = PERSIST_TESTED_NOTES): GeneratedBoard {
  const doc = new Y.Doc();
  const updates = startCapture(doc);
  initDoc(doc);
  const rand = mulberry32(0x51ed270b);
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  for (let i = 0; i < noteCount; i++) {
    const cluster = Math.floor(i / 20);
    const clusterX = (cluster % 10) * 1600;
    const clusterY = Math.floor(cluster / 10) * 1200;
    const x = clusterX + rand() * 1400;
    const y = clusterY + rand() * 1000;
    const id = createSticky(doc, { x, y }, colors[Math.floor(rand() * colors.length)]);
    if (typeof id !== 'string') continue;
    const text = getStickyText(doc, id);
    if (text) {
      doc.transact(() => {
        text.insert(0, phrase(rand));
      }, LOCAL_ORIGIN);
    }
  }
  return { updates, board: snapshot(doc) };
}

// Damaged bytes fixtures: a truncated update (last 10 bytes removed) and
// same-length pseudo-random bytes. Both must make Y.applyUpdate throw; the
// tests assert that before using them.
export function truncatedBytes(update: Uint8Array): Uint8Array {
  if (update.byteLength <= 10) throw new Error('update too small to truncate');
  return update.slice(0, update.byteLength - 10);
}

export function randomBytesLike(update: Uint8Array, seed = 0x9e3779b9): Uint8Array {
  const rand = mulberry32(seed);
  const bytes = new Uint8Array(update.byteLength);
  for (let i = 0; i < bytes.byteLength; i++) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}
