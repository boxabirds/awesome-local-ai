/**
 * Board fixtures (`persist.*` tests).
 *
 * Boards are generated with the *real* `board-model` functions, so the bytes the
 * persistence tests store and reload are exactly the bytes a person's edits
 * would produce — never a hand-written Yjs document.
 *
 * `updates` is one entry per note: note creation and its text are wrapped in one
 * transaction, so a fixture of 25 notes is 25 (plus the schema stamp) real Yjs
 * updates, which is what makes the compaction thresholds reachable.
 */

import * as Y from "yjs";
import {
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  stickySnapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "../../src/shared/config";

export interface BoardFixture {
  doc: Y.Doc;
  /** The board as its author sees it. */
  notes: readonly StickySnapshot[];
  /** One update per note (plus the schema stamp first), in creation order. */
  updates: Uint8Array[];
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic RNG (mulberry32) so every run of a persistence test rebuilds the same board. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the 25-note retro board ---------------------------------------------

/** A retro board: mixed colours, multi-line text, overlapping positions. */
export const RETRO_ITEMS: readonly string[] = [
  "Shipped the onboarding flow\n(does anyone actually read the tooltip?)",
  "Blocked: the export API returns 500 after 30s",
  "Keep the weekly demo\nit is the only time design and engineering see the same thing",
  "Try smaller batches in the next sprint",
  "Ask support which three questions keep coming back",
  "The empty board needs a hint, not a tour",
  "Investigate the drag lag on the big board\nit felt like 2 frames",
  "Nobody noticed the new colour palette — is that good or bad?",
  "Write down who decides the roadmap\nbefore the next argument",
  "Pair the new hire with someone for two days",
  "Cut the meeting that only reports status",
  "Mobile: pinch zoom is the first thing people try",
  "Our own board got lost when the laptop restarted",
  "Notes should survive a reload\nthat is the whole product",
  "Too many boards with no names — add titles next",
  "The dot grid is doing more work than the design review says",
  "One person per board link, for the workshop at least",
  "Measure how long a board stays open",
  "Stop colouring by mood: pick a meaning and write it down",
  "The board should open in under three seconds",
  "Someone deleted a note by accident and nobody could get it back",
  "Keep the retro\nbut start it with what shipped, not what went wrong",
  "Comments need names\nanonymous feedback is not feedback",
  "The zoom limit is too close for the big boards",
  "Do the workshop asynchronously across the two offices",
];

/**
 * `count` notes (default 25): every one of them created in its own transaction,
 * with colour, text and position from the seeded random, and positions clustered
 * so notes overlap and stacking matters.
 */
export function retroBoard(count = 25, seed = 20260901): BoardFixture {
  const doc = new Y.Doc();
  initDoc(doc);

  const random = seededRandom(seed);
  const updates: Uint8Array[] = [Y.encodeStateAsUpdate(doc)];

  for (let index = 0; index < count; index += 1) {
    const cluster = index % 5;
    const x = cluster * 320 + Math.round(random() * 260) - 130;
    const y = Math.round(index / 5) * 210 + Math.round(random() * 180) - 90;
    const color = COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)] ?? "yellow";
    const text = RETRO_ITEMS[index % RETRO_ITEMS.length]!;

    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      const id = createSticky(doc, { x, y }, color);
      if (typeof id === "string") getStickyText(doc, id)?.insert(0, text);
    });
    updates.push(Y.encodeStateAsUpdate(doc, before));
  }

  return { doc, notes: stickySnapshot(doc) as StickySnapshot[], updates };
}

// ---- the PERSIST_TESTED_NOTES board --------------------------------------

const WORDS = [
  "the", "board", "note", "team", "sprint", "idea", "workshop", "queue", "release", "handoff",
  "blocked", "shipped", "follow", "async", "remote", "office", "demo", "retro", "feedback", "owner",
  "does", "not", "keep", "move", "try", "ask", "write", "cut", "pair", "measure",
  "colour", "zoom", "drag", "stack", "layer", "comment", "link", "address", "restart", "saved",
  "because", "before", "after", "when", "until", "someone", "nobody", "everyone", "again", "today",
];

/** Realistic English phrases, 10-300 characters, deterministic for a seed. */
export function realisticPhrase(random: () => number): string {
  const words = 3 + Math.floor(random() * 27);
  const parts: string[] = [];
  for (let index = 0; index < words; index += 1) {
    parts.push(WORDS[Math.floor(random() * WORDS.length)]!);
  }
  let phrase = parts.join(" ");
  if (random() < 0.25) {
    phrase = `${phrase.slice(0, Math.floor(phrase.length / 2))}\n${phrase.slice(Math.floor(phrase.length / 2))}`;
  }
  phrase = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
  if (phrase.length < 10) phrase = `${phrase} and then some more words`;
  return phrase.slice(0, 300);
}

/**
 * The board size the PRD names (`PERSIST_TESTED_NOTES`), laid out in clusters of
 * overlapping notes. Each note is its own transaction, so the log reaches the
 * compaction threshold on its own.
 */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 20260904): BoardFixture {
  const doc = new Y.Doc();
  initDoc(doc);

  const random = seededRandom(seed);
  const updates: Uint8Array[] = [Y.encodeStateAsUpdate(doc)];
  const perCluster = 40;

  for (let index = 0; index < count; index += 1) {
    const cluster = Math.floor(index / perCluster);
    const originX = (cluster % 12) * (STICKY_SIZE_WORLD * 2);
    const originY = Math.floor(cluster / 12) * (STICKY_SIZE_WORLD * 2);
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      const id = createSticky(
        doc,
        {
          x: originX + Math.round(random() * STICKY_SIZE_WORLD * 2),
          y: originY + Math.round(random() * STICKY_SIZE_WORLD * 2),
        },
        COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)] ?? "yellow",
      );
      if (typeof id === "string") getStickyText(doc, id)?.insert(0, realisticPhrase(random));
    });
    updates.push(Y.encodeStateAsUpdate(doc, before));
  }

  return { doc, notes: stickySnapshot(doc) as StickySnapshot[], updates };
}

// ---- small edits, for reaching the compaction thresholds ------------------

/**
 * `count` single-property edits, one transaction each: the cheap way to grow an
 * update log past `COMPACTION_UPDATE_COUNT` without growing the board.
 */
export function seededEdits(doc: Y.Doc, count: number, seed = 20260902): Uint8Array[] {
  const random = seededRandom(seed);
  const ids = stickySnapshot(doc).map((note) => note.id);
  if (ids.length === 0) throw new Error("seededEdits needs a board with notes");

  const updates: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = ids[index % ids.length]!;
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      if (index % 2 === 0) {
        moveObject(doc, id, Math.round(random() * 2_000), Math.round(random() * 2_000));
      } else {
        setStickyColor(doc, id, COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)]!);
      }
    });
    updates.push(Y.encodeStateAsUpdate(doc, before));
  }
  return updates;
}

// ---- damaged data fixtures ------------------------------------------------

/**
 * The two damage shapes from `design.md`: a log row with its last 10 bytes cut
 * off, and random bytes of the same length.
 */
export function damagedVariants(update: Uint8Array): { truncated: Uint8Array; randomBytes: Uint8Array } {
  const cut = Math.max(1, update.byteLength - 10);
  const truncated = update.slice(0, cut);
  const random = seededRandom(0xc0ffee);
  const randomBytes = new Uint8Array(update.byteLength);
  for (let index = 0; index < randomBytes.byteLength; index += 1) {
    randomBytes[index] = Math.floor(random() * 256);
  }
  return { truncated, randomBytes };
}
