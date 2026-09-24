/**
 * Realistic boards for persistence tests, built with the real board-model functions so every
 * byte is a real Yjs update.
 *
 * - `retroLog()`: a 25-note retrospective written by several people, as the ordered list of
 *   updates a room would have logged (one row per change, each change made by its own client,
 *   as happens when several people edit). Mixed colours, multi-line texts, overlapping notes.
 * - `largeBoard()`: PERSIST_TESTED_NOTES notes of 10–300 characters of English, in clusters.
 * - Damaged bytes: `truncated()` (last DAMAGE_TRUNCATE_BYTES removed) and `randomLike()`.
 */
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';

export const RETRO_NOTES = 25;
/** Bytes cut from the end of an update to damage it. */
export const DAMAGE_TRUNCATE_BYTES = 10;
export const MIN_PHRASE_CHARS = 10;
export const MAX_PHRASE_CHARS = 300;

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
/** Retro notes sit on a grid closer than a note's size, so neighbours overlap. */
const RETRO_COLUMNS = 5;
const RETRO_SPACING = 150;
const CLUSTER_SIZE = 40;
const CLUSTER_SPACING = 2000;
const CLUSTER_COLUMNS = 8;
const NOTE_JITTER = 900;

const RETRO_TEXTS = [
  'Went well: release train kept to schedule',
  'To improve:\nflaky checkout tests blocked two merges',
  'Action: pair on test isolation next sprint',
  'Standups ran long again',
  'Great support from the platform team 🎉',
  'Design review came too late\nfor the pricing page',
  'On-call handover notes were excellent',
  'We shipped the search filters!',
  'Too many meetings on Wednesday',
  'Customer interviews: 6 done, 4 booked',
  'Docs site is out of date',
  'Keep: demo every Friday',
  'Question: who owns the billing alerts?',
  'Pairing sessions helped new starters',
  'Deploys took 40 min on Tuesday',
  'Try: async planning notes before the meeting',
  'Accessibility audit found 12 issues\n- 3 critical\n- 9 minor',
  'Thanks Priya for the migration script',
  'Backlog grooming was rushed',
  'Mobile crash rate down to 0.2%',
  'Idea: rotate retro facilitator',
  'Need clearer acceptance criteria',
  'Staging was down for half a day',
  'Celebrate: 1,000th customer',
  '',
];

const WORDS = (
  'the team agreed to review onboarding pricing checkout search release customer feedback ' +
  'sprint metrics dashboard latency incident roadmap quarter goal migration database schema ' +
  'design research interview survey support ticket backlog priority estimate deploy pipeline ' +
  'test coverage documentation accessibility mobile desktop browser performance budget risk ' +
  'owner deadline workshop idea question action follow up next week clarify scope reduce ' +
  'improve measure launch experiment hypothesis signal churn retention growth partner'
).split(' ');

/** Deterministic PRNG (mulberry32) so fixtures are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An English-looking phrase of MIN_PHRASE_CHARS–MAX_PHRASE_CHARS characters. */
export function phrase(rand: () => number): string {
  const target = MIN_PHRASE_CHARS + Math.floor(rand() * (MAX_PHRASE_CHARS - MIN_PHRASE_CHARS + 1));
  let out = '';
  while (out.length < target) {
    const word = WORDS[Math.floor(rand() * WORDS.length)]!;
    out = out.length === 0 ? word[0]!.toUpperCase() + word.slice(1) : `${out} ${word}`;
  }
  return out.slice(0, target).trimEnd().padEnd(MIN_PHRASE_CHARS, '.');
}

function setText(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id);
  if (!ytext || text === '') return;
  doc.transact(() => ytext.insert(0, text), LOCAL_ORIGIN);
}

/**
 * Records a board as a room would log it: every `step` runs on a fresh client that has the
 * board so far, and its changes become one logged update.
 */
export class LogBuilder {
  readonly doc = new Y.Doc();
  readonly updates: Uint8Array[] = [];

  step(change: (doc: Y.Doc) => void): void {
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(this.doc));
    const before = Y.encodeStateVector(client);
    change(client);
    const update = Y.encodeStateAsUpdate(client, before);
    Y.applyUpdate(this.doc, update);
    this.updates.push(update);
    client.destroy();
  }

  /** Adds moves of existing notes until the log has `rows` rows. */
  padTo(rows: number, rand: () => number = seededRandom(rows)): void {
    const ids = snapshot(this.doc).map((n) => n.id);
    while (this.updates.length < rows) {
      const id = ids[Math.floor(rand() * ids.length)]!;
      this.step((d) => {
        moveObject(d, id, Math.round(rand() * 1000), Math.round(rand() * 1000));
      });
    }
  }
}

/** The 25-note retrospective as a log: row 1 initialises the doc, then one row per note. */
export function retroLog(): LogBuilder {
  const log = new LogBuilder();
  log.step((d) => initDoc(d));
  for (let i = 0; i < RETRO_NOTES; i += 1) {
    const at = { x: (i % RETRO_COLUMNS) * RETRO_SPACING, y: Math.floor(i / RETRO_COLUMNS) * RETRO_SPACING };
    log.step((d) => {
      const id = createSticky(d, at, COLORS[i % COLORS.length]);
      setText(d, id, RETRO_TEXTS[i % RETRO_TEXTS.length]!);
    });
  }
  // Someone lifts an earlier note above its neighbours (stacking differs from creation order).
  const third = snapshot(log.doc)[2]!.id;
  log.step((d) => {
    bringToFront(d, third);
    setStickyColor(d, third, 'violet');
  });
  return log;
}

/** A board of `count` realistic notes in clusters, built in one document. */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 42): Y.Doc {
  const rand = seededRandom(seed);
  const doc = new Y.Doc();
  initDoc(doc);
  for (let i = 0; i < count; i += 1) {
    const cluster = Math.floor(i / CLUSTER_SIZE);
    const cx = (cluster % CLUSTER_COLUMNS) * CLUSTER_SPACING;
    const cy = Math.floor(cluster / CLUSTER_COLUMNS) * CLUSTER_SPACING;
    const at = { x: cx + Math.round(rand() * NOTE_JITTER), y: cy + Math.round(rand() * NOTE_JITTER) };
    const id = createSticky(doc, at, COLORS[Math.floor(rand() * COLORS.length)]);
    setText(doc, id, phrase(rand));
  }
  return doc;
}

/** The update with its last DAMAGE_TRUNCATE_BYTES bytes removed. */
export function truncated(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.byteLength - DAMAGE_TRUNCATE_BYTES));
}

/** Random bytes of the same length as `update` (seeded). */
export function randomLike(update: Uint8Array, seed = 7): Uint8Array {
  const rand = seededRandom(seed);
  return Uint8Array.from({ length: update.byteLength }, () => Math.floor(rand() * 256));
}

/** Notes compared by everything the PRD calls "identical": text, colour, position, stacking. */
export function boardState(doc: Y.Doc): Pick<StickySnapshot, 'id' | 'text' | 'color' | 'x' | 'y' | 'z'>[] {
  return snapshot(doc).map(({ id, text, color, x, y, z }) => ({ id, text, color, x, y, z }));
}

// ---- Story 7: the 20-note retro board for multi-select ----

export const SELECTION_RETRO_NOTES = 20;
/** Notes per cluster; the board has two clusters. */
export const SELECTION_CLUSTER_NOTES = 10;
const SELECTION_CLUSTER_COLUMNS = 5;
/** Neighbours are closer than a note's width, so notes in a cluster overlap. */
const SELECTION_NOTE_SPACING = 150;
/** World x of the left edge of each cluster's first note (clusters far apart). */
export const SELECTION_CLUSTER_X = [-1800, 1200] as const;
export const SELECTION_CLUSTER_Y = -300;
/** createSticky takes the centre; the fixture is laid out by top-left corners. */
const TO_CENTRE = STICKY_SIZE_WORLD / 2;

/**
 * 20 realistic retro notes in two clusters of 10 (2 rows × 5, overlapping neighbours), created
 * in one document; the first cluster's third note is lifted above its neighbours.
 */
export function selectionRetroBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  for (let i = 0; i < SELECTION_RETRO_NOTES; i += 1) {
    const cluster = Math.floor(i / SELECTION_CLUSTER_NOTES);
    const k = i % SELECTION_CLUSTER_NOTES;
    const x = SELECTION_CLUSTER_X[cluster]! + (k % SELECTION_CLUSTER_COLUMNS) * SELECTION_NOTE_SPACING;
    const y = SELECTION_CLUSTER_Y + Math.floor(k / SELECTION_CLUSTER_COLUMNS) * SELECTION_NOTE_SPACING;
    const id = createSticky(doc, { x: x + TO_CENTRE, y: y + TO_CENTRE }, COLORS[i % COLORS.length]);
    setText(doc, id, RETRO_TEXTS[i % RETRO_TEXTS.length]!);
  }
  bringToFront(doc, snapshot(doc)[2]!.id);
  return doc;
}
