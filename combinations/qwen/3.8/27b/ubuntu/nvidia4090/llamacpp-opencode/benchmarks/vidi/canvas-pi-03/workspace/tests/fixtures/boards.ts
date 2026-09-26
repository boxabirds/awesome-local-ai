/**
 * Board fixtures for story 4 persistence tests (unit, integration and e2e).
 *
 * Boards are built with the REAL board-model calls (createSticky + Y.Text), so
 * the persisted bytes are exactly what the app writes. Each note is emitted as
 * one incremental Yjs update (base64); the first update is a full state (it
 * carries meta), so the sequence applies to any empty doc in order.
 */
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
  LOCAL_ORIGIN,
  type StickySnapshot,
} from '@/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '@/shared/config';
import { mulberry32 } from '../integration/random-ops';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** A long enough prose base to cut realistic phrases of any length <= 300. */
const PROSE =
  'The team gathered around the infinite board with a simple goal to turn a messy ' +
  'afternoon of discussion into ideas anyone could see move and remember. Each sticky ' +
  'note held one thought a complaint about onboarding a bet on a new feature a reminder ' +
  'about the launch date. As the conversation moved the notes moved with it. Colours ' +
  'separated the themes and position separated the priorities. By the end of the hour ' +
  'the board told the story of the meeting better than any minutes could and the group ' +
  'agreed to keep it as the starting point for the next planning cycle where every idea ' +
  'could still be rearranged until the right shape of the work emerged from the clutter ' +
  'of the first afternoon. Someone photographed the wall of colours for the retro and ' +
  'the following week the same board opened the sprint review each note a small promise ' +
  'waiting to be kept or quietly discarded as the work settled into its final ' +
  'arrangement before the standup turned to the next set of questions the team was ready ' +
  'for whatever came next on the board and nothing was ever quite thrown away.';

/** Cuts PROSE at a word boundary to a length in [minLen, maxLen] (deterministic). */
function phrase(rng: () => number, minLen: number, maxLen: number): string {
  const target = Math.min(maxLen, Math.max(minLen, Math.floor(minLen + rng() * (maxLen - minLen + 1))));
  if (target >= PROSE.length) return PROSE;
  // Cut at the last space at or before `target`.
  let cut = PROSE.lastIndexOf(' ', target);
  if (cut <= 0) cut = target;
  return PROSE.slice(0, cut);
}

export interface NoteSpec {
  x: number;
  y: number;
  color: StickyColor;
  text: string;
}

/**
 * A 25-note retro board: mixed colours, multi-line and single-line text,
 * overlapping positions. Deterministic (seeded).
 */
export function retroBoardSpecs(): NoteSpec[] {
  const rng = mulberry32(20240601);
  const specs: NoteSpec[] = [];
  for (let i = 0; i < 25; i++) {
    const multiline = i % 4 === 0;
    const base = phrase(rng, 12, 120);
    const text = multiline ? `${base}\nfollow-up: ${phrase(rng, 8, 40)}` : base;
    specs.push({
      // Overlapping cluster around the origin (retro walls are dense).
      x: Math.round(rng() * 1600) - 800,
      y: Math.round(rng() * 1000) - 500,
      color: COLORS[Math.floor(rng() * COLORS.length)],
      text,
    });
  }
  return specs;
}

/**
 * A PERSIST_TESTED_NOTES-note board: realistic 10–300 char phrases in loose
 * clusters. Deterministic (seeded). Sized so the encoded snapshot exceeds
 * SNAPSHOT_CHUNK_BYTES (TC-08 multi-chunk).
 */
export function bigBoardSpecs(count: number = PERSIST_TESTED_NOTES): NoteSpec[] {
  const rng = mulberry32(0x5eed);
  const specs: NoteSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Cluster notes around a handful of anchor points (realistic grouping).
    const cluster = i % 7;
    const cx = (cluster - 3) * 900;
    const cy = Math.floor(cluster / 3) * 700 - 700;
    specs.push({
      x: Math.round(cx + (rng() * 600 - 300)),
      y: Math.round(cy + (rng() * 400 - 200)),
      color: COLORS[Math.floor(rng() * COLORS.length)],
      text: phrase(rng, 10, 300),
    });
  }
  return specs;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function applySpecs(doc: Y.Doc, specs: NoteSpec[]): void {
  for (const s of specs) {
    const id = createSticky(doc, { x: s.x, y: s.y }, s.color);
    if (s.text) {
      const t = getStickyText(doc, id);
      if (t) doc.transact(() => t.insert(0, s.text), LOCAL_ORIGIN);
    }
  }
}

/**
 * Build the board once from a single doc: one base64 incremental update per
 * note (the first is a full state carrying meta), the final note snapshot, and
 * a single full-state update. Building once means `notes` and `fullState`
 * share the same ids (separate builds would mint different UUIDs).
 */
export function buildBoard(specs: NoteSpec[]): {
  updates: string[];
  notes: readonly StickySnapshot[];
  fullState: string;
} {
  const doc = new Y.Doc();
  const updates: string[] = [];
  // Capture the empty state vector BEFORE initDoc so the first update is a
  // full state that carries meta + note0 (initDoc stamps meta). The room
  // replays rows onto a pristine, meta-less doc, so row 0 must be a full
  // state for the later same-client deltas to be replayable.
  let before = Y.encodeStateVector(doc);
  initDoc(doc);
  for (const s of specs) {
    applySpecs(doc, [s]);
    updates.push(toB64(Y.encodeStateAsUpdate(doc, before)));
    before = Y.encodeStateVector(doc);
  }
  return { updates, notes: snapshot(doc), fullState: toB64(Y.encodeStateAsUpdate(doc)) };
}

export function buildBoardUpdates(specs: NoteSpec[]): {
  updates: string[];
  notes: readonly StickySnapshot[];
} {
  const { updates, notes } = buildBoard(specs);
  return { updates, notes };
}

/** Encodes the whole board (all specs) as a single full-state update (base64). */
export function fullStateUpdate(specs: NoteSpec[]): string {
  return buildBoard(specs).fullState;
}

/**
 * Build a board whose notes come from several distinct Yjs clients (each with
 * its own clientID) plus a base set of notes from the "server" client that
 * establishes the shared top-level types. Returns one update per contributing
 * client. Because the clients have different clientIDs, each update is
 * independently applicable: a damaged one loses only its own notes (unlike
 * same-client incremental deltas, which form a strict chain).
 */
export function buildMultiClientBoard(opts: {
  baseNotes: number;
  clients: number;
  notesPerClient: number;
}): { updates: string[]; notes: readonly StickySnapshot[]; lostIfRowK: number } {
  const { baseNotes, clients, notesPerClient } = opts;
  const server = new Y.Doc();
  const updates: string[] = [];
  // Empty state vector before initDoc: the base-notes update is a full state
  // carrying meta + the base notes (see buildBoard).
  const baseBefore = Y.encodeStateVector(server);
  initDoc(server);
  {
    for (let i = 0; i < baseNotes; i++) createSticky(server, { x: i * 10, y: 0 }, 'yellow');
    updates.push(toB64(Y.encodeStateAsUpdate(server, baseBefore)));
  }
  for (let c = 0; c < clients; c++) {
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server), 'sync');
    const before = Y.encodeStateVector(server);
    for (let n = 0; n < notesPerClient; n++) createSticky(client, { x: 1000 + c * 100 + n * 10, y: 0 }, 'blue');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client), 'sync');
    updates.push(toB64(Y.encodeStateAsUpdate(server, before)));
  }
  return { updates, notes: snapshot(server), lostIfRowK: notesPerClient };
}

/** A truncated copy of `u` (last `n` bytes removed) — a damaged update. */
export function truncated(u: Uint8Array, n = 10): Uint8Array {
  return u.slice(0, Math.max(0, u.length - n));
}

/** Same-length random bytes — a damaged update/snapshot chunk. */
export function randomSameLength(u: Uint8Array): Uint8Array {
  const out = new Uint8Array(u.length);
  crypto.getRandomValues(out);
  return out;
}
