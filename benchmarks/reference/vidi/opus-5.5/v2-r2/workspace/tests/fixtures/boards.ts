// Realistic boards built with the real board-model functions, so every byte is a
// real Yjs update (story 4 persistence tests).
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { seededRandom } from './random-ops';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS = [
  'Went well: pairing on the release checklist',
  'Improve: flaky end-to-end tests\nslow every merge down',
  'Action: rotate the on-call buddy weekly',
  'Standups run long —\nmove details to threads',
  'Great customer call with Acme on Tuesday',
  'Docs for the billing API are out of date',
  'Celebrate: zero incidents this sprint!',
  'Design review happened too late\nfor the settings page',
  'Try a no-meeting Wednesday',
  'Onboarding guide saved Maya two days',
  'Deploys take 40 minutes;\ncan we cache the build?',
  'More async demos, fewer live ones',
];

const PHRASES = [
  'Customers want export to spreadsheets',
  'Pricing page confuses first-time visitors because the tiers look alike',
  'Faster onboarding',
  'Interview five churned users before the planning meeting next month',
  'Mobile layout breaks on small screens when the keyboard is open',
  'Idea: weekly digest email summarising board activity for people who were away',
  'Reduce support tickets about password resets',
  'Partner integrations',
  'Our quarterly planning session surfaced a recurring theme: new teammates take far too long to become productive, and several people spent their first two weeks hunting for access requests and outdated setup guides.',
  'Research: how do competitors handle offline editing?',
  'Accessibility audit of the checkout flow, including keyboard-only navigation and screen reader labels for every form field',
  'Dark mode',
];

export interface FixtureRow {
  /** One Yjs update, exactly as the room would store it. */
  data: Uint8Array;
  /** The note this update belongs to. */
  noteId: string;
}

export interface BoardFixture {
  doc: Y.Doc;
  /** Updates in creation order; applying them all to an empty doc gives `doc`. */
  rows: FixtureRow[];
}

function typeInto(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id);
  if (!ytext) throw new Error(`note ${id} has no text`);
  doc.transact(() => ytext.insert(ytext.length, text), LOCAL_ORIGIN);
}

/**
 * A 25-note retro board: mixed colours, multi-line texts, overlapping notes with
 * varied stacking. Each note is written by its own participant (as on a real
 * shared board), so one damaged update only affects that participant's note.
 */
export function retroBoard(count = 25): BoardFixture {
  const doc = new Y.Doc();
  const rows: FixtureRow[] = [];
  const noteIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const participant = new Y.Doc();
    Y.applyUpdate(participant, Y.encodeStateAsUpdate(doc));
    let noteId = '';
    participant.on('update', (update: Uint8Array) => {
      rows.push({ data: update, noteId });
      Y.applyUpdate(doc, update);
    });
    // Columns of overlapping notes (120 apart for 200-unit notes).
    const at = { x: (i % 5) * 260 + (i % 2) * 40, y: Math.floor(i / 5) * 120 };
    const id = createSticky(participant, at, COLORS[i % COLORS.length]);
    if (id === false) throw new Error('create failed');
    noteId = id;
    noteIds.push(id);
    rows[rows.length - 1]!.noteId = id;
    typeInto(participant, id, RETRO_TEXTS[i % RETRO_TEXTS.length]!);
    if (i % 4 === 3) moveObject(participant, id, at.x + 30, at.y - 15);
    participant.destroy();
  }
  // Lift a few earlier notes above later ones, as people do while arranging.
  for (const k of [2, 9, 16]) {
    const noteId = noteIds[k];
    if (!noteId) continue;
    const participant = new Y.Doc();
    Y.applyUpdate(participant, Y.encodeStateAsUpdate(doc));
    participant.on('update', (update: Uint8Array) => {
      rows.push({ data: update, noteId });
      Y.applyUpdate(doc, update);
    });
    bringToFront(participant, noteId);
    participant.destroy();
  }
  return { doc, rows };
}

/** Realistic English text of 10–300 characters. */
function phrase(rand: () => number): string {
  const min = 10;
  const max = 300;
  const target = min + Math.floor(rand() * (max - min + 1));
  let text = PHRASES[Math.floor(rand() * PHRASES.length)]!;
  while (text.length < target) text += ` ${PHRASES[Math.floor(rand() * PHRASES.length)]!}`;
  return text.slice(0, target).trimEnd() || text.slice(0, min);
}

/**
 * A board of `count` (default PERSIST_TESTED_NOTES) notes with realistic phrases,
 * laid out in clusters. Built in one doc: only the final state matters here.
 */
export function largeBoard(count = PERSIST_TESTED_NOTES, seed = 4004): Y.Doc {
  const rand = seededRandom(seed);
  const doc = new Y.Doc();
  initDoc(doc);
  const perCluster = 50;
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(i / perCluster);
    const inCluster = i % perCluster;
    const cx = (cluster % 8) * 2600;
    const cy = Math.floor(cluster / 8) * 2600;
    const at = { x: cx + (inCluster % 10) * 220 + rand() * 40, y: cy + Math.floor(inCluster / 10) * 220 + rand() * 40 };
    const id = createSticky(doc, at, COLORS[Math.floor(rand() * COLORS.length)]);
    if (id === false) throw new Error('create failed');
    typeInto(doc, id, phrase(rand));
  }
  return doc;
}

/** Damaged update: the last 10 bytes removed. */
export function truncated(data: Uint8Array): Uint8Array {
  return data.slice(0, Math.max(0, data.length - 10));
}

/** Damaged update: seeded random bytes of the same length. */
export function randomBytes(length: number, seed = 99): Uint8Array {
  const rand = seededRandom(seed);
  return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
}
