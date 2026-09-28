/**
 * Story 4 fixtures: deterministic boards used by the persistence suites.
 *
 * - `makeRetroBoard`: the 25-note "retro board" (mixed colours, multi-line
 *   text, overlapping positions) used by the e2e "Overnight return" workflow.
 * - `makeLargeBoard(n)`: an n-note board (default PERSIST_TESTED_NOTES) with
 *   realistic 10–300 char phrases clustered in regions, for the large-board
 *   compaction / load-budget tests.
 * - damaged-bytes helpers for the quarantine / snapshot-corruption error paths.
 *
 * All boards are built with real board-model calls, so the encoded updates are
 * exactly what the room would produce. A deterministic PRNG keeps runs
 * reproducible (identical seed → identical notes and bytes).
 */
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
} from 'src/shared/board-model';
import { PERSIST_TESTED_NOTES, type StickyColor } from 'src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export interface SeededBoard {
  /** The whole board state as a single Yjs update (append this to the log). */
  update: Uint8Array;
  /** The expected snapshot (for assertions). */
  notes: ReturnType<typeof snapshot>;
}

/** Small deterministic PRNG (LCG) so seeded runs are byte-reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const PHRASES = [
  'Ship the onboarding flow',
  'Refactor the billing module before Friday',
  'Add loading skeletons to the dashboard',
  'Investigate the flaky integration test',
  'Write docs for the new public API',
  'Fix the memory leak in the worker',
  'Design the empty state for the inbox',
  'Bump dependencies and re-run CI',
  'Add dark mode to the settings page',
  'Profile the render loop under load',
  'Migrate the config to typed schema',
  'Review the PR for the auth service',
  'Add rate limiting to the public endpoints',
  'Clean up the legacy flag code',
  'Improve the search relevance ranking',
  'Add unit tests for the date utils',
  'Tune the websocket reconnect backoff',
  'Extract the shared form validators',
  'Add keyboard shortcuts to the editor',
  'Fix the off-by-one in the pagination',
];

function makeBoard(notes: number, seed: number, cluster: boolean): SeededBoard {
  const doc = new Y.Doc();
  initDoc(doc);
  const rand = lcg(seed);
  for (let i = 0; i < notes; i++) {
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    let x: number;
    let y: number;
    if (cluster) {
      // Cluster notes into a handful of regions (realistic board layout).
      const regionX = Math.floor(rand() * 4) * 600;
      const regionY = Math.floor(rand() * 3) * 400;
      x = regionX + Math.floor(rand() * 500);
      y = regionY + Math.floor(rand() * 350);
    } else {
      x = Math.floor(rand() * 1200);
      y = Math.floor(rand() * 900);
    }
    const id = createSticky(doc, { x, y }, color, `note-${seed}-${i}`);
    if (id) {
      // Realistic 10–300 char multi-line phrase. The large board targets ~300
      // chars/note so PERSIST_TESTED_NOTES notes encode past SNAPSHOT_CHUNK_BYTES
      // (multiple snapshot chunks on compaction).
      const base = PHRASES[i % PHRASES.length];
      const second = PHRASES[(i + 5) % PHRASES.length];
      const third = PHRASES[(i + 11) % PHRASES.length];
      const pad = 'x'.repeat(20 + Math.floor(rand() * 60));
      const text = `${base}. Follow-up: ${second}. Notes: ${third} — ${i}. ${pad}`;
      getStickyText(doc, id)?.insert(0, text);
    }
  }
  return { update: Y.encodeStateAsUpdate(doc), notes: snapshot(doc) };
}

/** The 25-note retro board (mixed colours, multi-line text, overlaps). */
export function makeRetroBoard(): SeededBoard {
  return makeBoard(25, 0x5eed, false);
}

/** An n-note board (default PERSIST_TESTED_NOTES) with clustered, realistic text. */
export function makeLargeBoard(n: number = PERSIST_TESTED_NOTES): SeededBoard {
  return makeBoard(n, 0xb1a25, true);
}

/** A truncated update (last 10 bytes cut) — Yjs cannot decode it. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  const cut = Math.min(10, update.length);
  return update.subarray(0, update.length - cut);
}

/** Same-length random bytes — a valid-length but undecodable "update". */
export function randomBytesSameLength(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(update.length);
  const rand = lcg(0xdeadbeef);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}
