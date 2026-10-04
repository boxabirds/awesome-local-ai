/**
 * Realistic board fixtures for the persistence tests. Boards are generated
 * through the real `board-model` functions, so the bytes that get stored are
 * real Yjs updates.
 *
 * - `makeRetroBoardDoc`: 25-note retro board with mixed colours, multi-line
 *   texts and overlapping stacking.
 * - `makeLargeBoardDoc`: PERSIST_TESTED_NOTES notes of realistic English
 *   phrases (10–300 chars) laid out in clusters.
 * - Damaged bytes: a truncated update (last 10 bytes removed) and random
 *   bytes of the same length.
 */
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  bringToFront,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

/** Deterministic PRNG (mulberry32, same family as the story 3 random ops). */
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

const ALL_COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS: string[] = [
  'What went well\nthis sprint',
  'Ship the beta\nbefore Friday',
  'Ask Priya about\nthe on-call docs',
  'Idea: dark mode\nfor the board',
  'Blocker: API keys\nexpire tomorrow',
  'Praise: great\nstandup format',
  'Follow up with\nlegal on licensing',
  'Retro action:\nrotate the docs owner',
  'Customer quote:\n"it just works"',
  'Metric: p95 latency\nup 12% this week',
  'Risk: single\npoint of failure',
  'Win: zero downtime\nduring the migration',
  'Experiment: try\nasync standups',
  'Debate: tabs vs\nspaces (again)',
  'Idea: keyboard\nshortcuts for colours',
  'Note: the demo\nneeds a backup plan',
  'Question: who owns\nthe release notes?',
  'Grumble: meeting\ncould have been an email',
  'Plan: freeze\non Thursday',
  'Tip: rename branches\nbefore merging',
  'Watch out: flaky\ntest in CI',
  'Celebrate: hit the\nquarterly target',
  'Next: pilot the\nnew onboarding',
  'Remember: update\nthe status page',
  'Stretch goal:\ncut bundle size 20%',
];

/** 25-note retro board: mixed colours, multi-line texts, overlapping stacking. */
export function makeRetroBoardDoc(seed = 7): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const rng = mulberry32(seed);
  for (let i = 0; i < 25; i++) {
    const color = ALL_COLORS[i % ALL_COLORS.length];
    // Overlapping grid: 200px notes on a 160px pitch.
    const x = 80 + (i % 5) * 160 + Math.floor(rng() * 40);
    const y = 80 + Math.floor(i / 5) * 160 + Math.floor(rng() * 40);
    const id = createSticky(doc, { x, y }, color);
    getStickyText(doc, id)!.insert(0, RETRO_TEXTS[i]);
    // Vary the stacking order (some notes overlap, some are brought to front).
    if (i % 3 === 0) bringToFront(doc, id);
  }
  return doc;
}

const WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'while', 'the',
  'sprint', 'board', 'grows', 'ideas', 'stick', 'together', 'teams', 'brainstorm',
  'notes', 'colour', 'drag', 'move', 'share', 'review', 'plan', 'prioritise',
  'release', 'bug', 'feature', 'design', 'wireframe', 'prototype', 'feedback',
  'customer', 'value', 'stream', 'flow', 'focus', 'goal', 'target', 'metric',
  'latency', 'throughput', 'budget', 'quarter', 'annual', 'summary', 'retro',
];

/** A realistic English phrase of 10–300 characters. */
export function phrase(rng: () => number): string {
  const target = 10 + Math.floor(rng() * 291);
  const parts: string[] = [];
  let len = 0;
  while (len < target) {
    const w = WORDS[Math.floor(rng() * WORDS.length)];
    if (len > 0) len += 1; // space
    parts.push(w);
    len += w.length;
  }
  let text = parts.join(' ');
  if (text.length > target) text = text.slice(0, target).trimEnd();
  return text.length >= 10 ? text : text + ' note';
}

/** Clustered position for note `i` of the large board. */
export function largeBoardPosition(i: number): { x: number; y: number } {
  const cluster = Math.floor(i / 100);
  const inCluster = i % 100;
  return {
    x: cluster * 1500 + (inCluster % 10) * 120,
    y: Math.floor(inCluster / 10) * 120,
  };
}

/**
 * PERSIST_TESTED_NOTES-note board: realistic phrases in clusters. (For
 * incremental appends, build batch by batch with `largeBoardPosition` and
 * `phrase` so each batch yields one real update.)
 */
export function makeLargeBoardDoc(count: number = PERSIST_TESTED_NOTES, seed = 42): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, largeBoardPosition(i), ALL_COLORS[i % ALL_COLORS.length]);
    getStickyText(doc, id)!.insert(0, phrase(rng));
  }
  return doc;
}

/**
 * Apply `mutate` to `doc` and return a self-contained update of the whole
 * board state. The store logs one self-contained state per change (not a
 * delta) so that a single damaged row can never destroy the other rows on
 * load: Yjs delta logs are not robust to a missing middle row (the clock
 * gap silently drops every later row), which would violate
 * persist.partial_damage ("all other saved content intact").
 */
export function nextUpdate(doc: Y.Doc, mutate: () => void): Uint8Array {
  mutate();
  return Y.encodeStateAsUpdate(doc);
}

/** Damage: an update with its last 10 bytes removed. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Damage: random bytes of the given length (deterministic for the seed). */
export function randomBytesOfLength(length: number, seed = 99): Uint8Array {
  const rng = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rng() * 256);
  return out;
}
