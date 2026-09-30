import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  PERSIST_TESTED_NOTES,
  type StickyColor,
} from '../../src/shared/config';

/**
 * Story 4 test fixtures: boards generated with real board-model-style calls
 * and the raw update bytes they produce, so integration tests can replay
 * them through the store hooks.
 */

export interface GeneratedBoard {
  doc: Y.Doc;
  /** Every update the doc emitted, in order (replaying them reconstructs the board). */
  updates: Uint8Array[];
}

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
const WORDS = ['hello', 'world', 'foo', 'bar', 'baz', 'qux', 'test', 'note', 'idea', 'plan', 'ship', 'sync', 'draft', 'review', 'launch'];

/** Deterministic PRNG so fixtures are reproducible. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Creates one sticky (map + text) inside a single transaction so the whole
 * note is one update. Mirrors board-model createSticky plus a text insert.
 */
function createNoteInOneUpdate(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor,
  text: string,
  createdAt: number
): string {
  const id = crypto.randomUUID();
  const textObj = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', textObj);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', createdAt);
    objectsMap(doc).set(id, obj);
    if (text.length > 0) textObj.insert(0, text);
  });
  return id;
}

/**
 * 25-note retro board: mixed colours, multi-line text, overlapping
 * positions. One initDoc update plus one update per note (26 total).
 */
export function makeRetroBoard(): GeneratedBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u) => updates.push(u.slice()));
  const rng = mulberry32(1234);

  // initDoc equivalent
  const meta = doc.getMap('meta');
  meta.set('schemaVersion', 1);

  for (let i = 0; i < 25; i++) {
    const words = 3 + Math.floor(rng() * 12);
    const text = Array.from({ length: words }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
    createNoteInOneUpdate(
      doc,
      { x: Math.floor(rng() * 1200), y: Math.floor(rng() * 800) },
      COLORS[i % COLORS.length],
      text,
      1700000000000 + i * 1000
    );
  }
  return { doc, updates };
}

/**
 * PERSIST_TESTED_NOTES-note board: realistic 10–300 char phrases, positions
 * clustered in a few areas. One update per note (plus one initDoc update).
 * The encoded snapshot comfortably exceeds SNAPSHOT_CHUNK_BYTES (512 KB).
 */
export function makeLargeBoard(): GeneratedBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u) => updates.push(u.slice()));
  const rng = mulberry32(987654);

  const meta = doc.getMap('meta');
  meta.set('schemaVersion', 1);

  // A few cluster centres; notes scatter around them.
  const clusters = [
    { x: 200, y: 150 },
    { x: 900, y: 400 },
    { x: 450, y: 900 },
  ];

  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const c = clusters[i % clusters.length];
    const len = 10 + Math.floor(rng() * 291); // 10..300 chars
    const words = Math.max(2, Math.floor(len / 6));
    const text = Array.from({ length: words }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ').slice(0, len);
    createNoteInOneUpdate(
      doc,
      { x: c.x + Math.floor(rng() * 300) - 150, y: c.y + Math.floor(rng() * 300) - 150 },
      COLORS[Math.floor(rng() * COLORS.length)],
      text,
      1700000000000 + i
    );
  }
  return { doc, updates };
}

/** Damaged bytes: the last 10 bytes cut off. */
export function damageTruncated(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(0, update.length - 10));
  out.set(update.subarray(0, out.length));
  return out;
}

/** Damaged bytes: same length, random content. */
export function damageRandomSameLength(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(update.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
