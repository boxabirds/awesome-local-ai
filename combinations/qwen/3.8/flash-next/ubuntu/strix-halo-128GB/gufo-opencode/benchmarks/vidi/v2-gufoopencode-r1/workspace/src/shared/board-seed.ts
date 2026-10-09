import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc } from './board-model';
import { STICKY_COLORS, type StickyColor } from './config';

// Deterministic PRNG so every seeded board is reproducible from its seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'ship', 'retro', 'ideas', 'board', 'team', 'notes', 'sticky', 'canvas',
  'sprint', 'action', 'owner', 'blocker', 'praise', 'learning', 'queue', 'demo',
  'feature', 'bugfix', 'design', 'review', 'backup', 'handoff', 'agenda', 'summary',
  'goal', 'metric', 'insight', 'follow', 'upstream', 'unblock', 'pairing', 'sync',
  'kickoff', 'checkin', 'pilot', 'scope', 'budget', 'draft', 'final', 'vote',
  'cluster', 'theme', 'affinity', 'dot', 'timer', 'round', 'facilitator', 'parking'
];

// Realistic sentence-y text between minChars and maxChars characters.
export function phrase(random: () => number, minChars = 10, maxChars = 300): string {
  const target = minChars + Math.floor(random() * (maxChars - minChars));
  const parts: string[] = [];
  let length = 0;
  while (length < target) {
    const words = 4 + Math.floor(random() * 7);
    const sentence: string[] = [];
    for (let i = 0; i < words; i += 1) sentence.push(WORDS[Math.floor(random() * WORDS.length)]);
    const first = sentence[0];
    sentence[0] = first.charAt(0).toUpperCase() + first.slice(1);
    const text = sentence.join(' ') + '.';
    parts.push(text);
    length += text.length + 1;
  }
  return parts.join(' ').slice(0, maxChars);
}

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

// Populate a board with `count` realistic sticky notes: clustered columns with
// jitter (so some notes overlap), mixed colours, sentence text, and some
// multi-line notes. Every mutation goes through the board model.
export function seedBoard(doc: Y.Doc, count: number, random: () => number): string[] {
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const column = i % 6;
    const row = Math.floor(i / 6);
    const x = column * 250 + Math.floor(random() * 140) - 70;
    const y = row * 220 + Math.floor(random() * 100) - 50;
    const color = COLOR_KEYS[Math.floor(random() * COLOR_KEYS.length)];
    const id = createSticky(doc, { x, y }, color);
    if (typeof id !== 'string') continue;
    ids.push(id);
    const text = getStickyText(doc, id);
    if (text === undefined) continue;
    const body = random() < 0.25
      ? [phrase(random, 8, 60), phrase(random, 8, 60)].join('\n')
      : phrase(random, 10, 300);
    doc.transact(() => {
      text.insert(0, body);
    });
  }
  return ids;
}
