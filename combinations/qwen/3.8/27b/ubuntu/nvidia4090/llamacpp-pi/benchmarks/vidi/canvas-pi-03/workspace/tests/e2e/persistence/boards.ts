/**
 * Story 4 e2e board fixtures, built with real Yjs in the (Node) test process
 * and shipped to the browser through the client `applyUpdates` test hook.
 *
 * The notes' ids, text, colour, position, z and createdAt are deterministic
 * for a given seed, so a board seeded before a process restart can be
 * compared field-for-field against the board reloaded from storage after it.
 */
import * as Y from 'yjs';

export interface ExpectedNote {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
  createdAt: number;
}

const COLOR_KEYS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
const WORDS = [
  'ship', 'retro', 'blocker', 'idea', 'owner', 'due', 'follow', 'risk',
  'win', 'action', 'metric', 'goal', 'test', 'bug', 'launch', 'review',
  'deploy', 'draft', 'spike', 'metric', 'hypothesis', 'outcome',
];

/** Deterministic PRNG (mirrors tests/fixtures random-ops). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a board of `count` notes as a single full-state Yjs update (base64)
 * plus the expected note fields. The full state carries the top-level types
 * and meta, so it applies cleanly to the room's doc and makes later loads
 * replayable.
 */
export function buildBoardUpdates(count: number, seed = 20240601): { updates: string[]; notes: ExpectedNote[] } {
  const doc = new Y.Doc();
  const meta = doc.getMap('meta');
  const objects = doc.getMap('objects');
  meta.set('schemaVersion', 1);
  const rand = mulberry32(seed);
  const notes: ExpectedNote[] = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    const color = COLOR_KEYS[i % COLOR_KEYS.length];
    const x = Math.floor(rand() * 2400) - 800;
    const y = Math.floor(rand() * 1600) - 400;
    const text = `note ${i}: ${WORDS[i % WORDS.length]} ${Math.floor(rand() * 900) + 100}`;
    const createdAt = baseTime + i * 1000;
    const ytext = new Y.Text();
    ytext.insert(0, text);
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('color', color);
    obj.set('text', ytext);
    obj.set('z', i + 1);
    obj.set('createdAt', createdAt);
    objects.set(id, obj);
    notes.push({ id, x, y, color, text, z: i + 1, createdAt });
  }
  const update = Y.encodeStateAsUpdate(doc);
  return { updates: [Buffer.from(update).toString('base64')], notes };
}

/** Canonical key over a set of notes for cross-process comparison. */
export function notesKey(notes: Array<Partial<ExpectedNote> & { id: string }>): string {
  const map: Record<string, unknown> = {};
  for (const n of notes) {
    map[n.id] = { x: n.x, y: n.y, color: n.color, text: n.text, z: n.z, createdAt: n.createdAt };
  }
  return JSON.stringify(map, Object.keys(map).sort());
}
