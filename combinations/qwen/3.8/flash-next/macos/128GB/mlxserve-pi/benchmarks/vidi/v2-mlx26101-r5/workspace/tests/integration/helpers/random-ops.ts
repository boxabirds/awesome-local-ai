/**
 * Seeded random board operations for the convergence tests.
 *
 * Everything goes through the real board-model functions inside a `WsClient`
 * transaction, so each operation is one Yjs update on the wire — the same traffic a
 * person editing the board makes. The generator is deterministic from its seed, and
 * every test that uses it logs the seed so a failure can be replayed.
 */

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';
import type { WsClient } from './ws-client';

/** Seed used when a test does not ask for one; set `VIDI6_SEED` to replay another. */
export const DEFAULT_SEED = 20260817;

/** The seed the tests run with. */
export function seedFromEnvironment(fallback: number = DEFAULT_SEED): number {
  const raw = typeof process === 'undefined' ? undefined : process.env['VIDI6_SEED'];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** mulberry32: small, fast, deterministic; good enough to reproduce a test board. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words a person would actually type into a note. */
const WORDS = [
  'team', 'goal', 'spike', 'sync', 'park', 'later', 'ask', 'idea', 'fix', 'demo',
  'risk', 'note', 'vote', 'plan', 'help', 'next', 'root', 'edge', 'flow', 'test',
];

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** What a run of random operations managed to do. */
export interface OpCounts {
  typed: number;
  moved: number;
  created: number;
  recoloured: number;
  deleted: number;
  /** Operations the model refused (a stale id, a no-op move, an empty board). */
  skipped: number;
}

const emptyCounts = (): OpCounts => ({ typed: 0, moved: 0, created: 0, recoloured: 0, deleted: 0, skipped: 0 });

/**
 * Applies `count` random operations through the real board model. The mix is the one
 * the story tests against: 40 % typing, 30 % moves, 10 % creates, 10 % recolours,
 * 10 % deletes. A skipped operation sends nothing, exactly like the client.
 */
export function applyRandomOps(client: WsClient, count: number, random: () => number): OpCounts {
  const counts = emptyCounts();
  for (let index = 0; index < count; index++) {
    const roll = random();
    if (roll < 0.4) counts.typed += typeWord(client, random) ? 1 : 0;
    else if (roll < 0.7) counts.moved += moveNote(client, random) ? 1 : 0;
    else if (roll < 0.8) counts.created += createNote(client, random) ? 1 : 0;
    else if (roll < 0.9) counts.recoloured += recolourNote(client, random) ? 1 : 0;
    else counts.deleted += deleteNote(client, random) ? 1 : 0;
  }
  return counts;
}

/** Runs `count` operations per client, one client at a time, so they interleave. */
export async function applyRandomOpsRoundRobin(
  clients: readonly WsClient[],
  count: number,
  seed: number,
): Promise<OpCounts> {
  const total = emptyCounts();
  const streams = clients.map((_, index) => mulberry32((seed + index * 7919) >>> 0));
  for (let step = 0; step < count; step++) {
    for (const [index, client] of clients.entries()) {
      const stream = streams[index] as () => number;
      const counts = applyRandomOps(client, 1, stream);
      for (const key of Object.keys(total) as (keyof OpCounts)[]) total[key] += counts[key];
    }
  }
  return total;
}

function pick<T>(items: readonly T[], random: () => number): T | undefined {
  return items[Math.floor(random() * items.length) % items.length];
}

function noteIds(client: WsClient): string[] {
  return client.snapshot().map((note) => note.id);
}

function typeWord(client: WsClient, random: () => number): boolean {
  const ids = noteIds(client);
  const id = pick(ids, random);
  if (id === undefined) return false;
  const word = (pick(WORDS, random) as string) + ' ';
  let applied = false;
  client.transact((doc) => {
    const text = getStickyText(doc, id);
    if (!text) return;
    const at = Math.floor(random() * (text.length + 1));
    text.insert(at, word);
    applied = true;
  });
  return applied;
}

function moveNote(client: WsClient, random: () => number): boolean {
  const ids = noteIds(client);
  const id = pick(ids, random);
  if (id === undefined) return false;
  const x = Math.round(random() * 2000) - 1000;
  const y = Math.round(random() * 2000) - 1000;
  let applied = false;
  client.transact((doc) => {
    if (moveObject(doc, id, x, y)) applied = true;
  });
  return applied;
}

function createNote(client: WsClient, random: () => number): boolean {
  const x = Math.round(random() * 1000);
  const y = Math.round(random() * 1000);
  const color = (pick(COLOR_NAMES, random) ?? 'yellow') as StickyColor;
  let id: string | false = false;
  client.transact((doc) => {
    id = createSticky(doc, { x, y }, color);
  });
  return id !== false;
}

function recolourNote(client: WsClient, random: () => number): boolean {
  const ids = noteIds(client);
  const id = pick(ids, random);
  if (id === undefined) return false;
  const color = (pick(COLOR_NAMES, random) ?? 'yellow') as StickyColor;
  let applied = false;
  client.transact((doc) => {
    if (setStickyColor(doc, id as string, color)) applied = true;
  });
  return applied;
}

function deleteNote(client: WsClient, random: () => number): boolean {
  const ids = noteIds(client);
  const id = pick(ids, random);
  if (id === undefined) return false;
  let applied = false;
  client.transact((doc) => {
    if (deleteObject(doc, id)) applied = true;
  });
  return applied;
}
