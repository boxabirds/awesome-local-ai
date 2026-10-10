/**
 * Boards used by more than one suite, built through the real
 * `src/shared/board-model.ts` functions so the bytes are what the product makes
 * (design: fixtures). `tests/e2e/helpers/board.ts` deliberately does not reach
 * into a board doc — the browser path is the product's; this file is for the
 * suites that are *about* bytes and storage, where seeding through the product
 * would be a much slower way to arrive at the same board.
 *
 * The layout, text and colours are seeded, so a run's board can be rebuilt from
 * the seed alone — which is what makes a storage failure readable after the fact.
 * Note ids are the product's own random ids, so a board is compared with itself
 * inside one run, never with a stored expectation.
 */
import * as Y from "yjs";

import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_TEXT_MAX_CHARS,
  type StickyColor,
} from "../../src/shared/config";
import {
  createSticky,
  initDoc,
  snapshot,
  setStickyColor,
  type StickySnapshot,
} from "../../src/shared/board-model";

/** mulberry32: 32 bits of state, enough to rebuild a board exactly. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t >>> 7;
    t = Math.imul(t ^ (t >>> 3), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The colour names a note can hold, in the order the product lists them. */
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Sentences to build notes from: English prose, varied in length. */
const SENTENCES = [
  "The team gathered around the board to capture every idea from the last quarter",
  "Sticky notes in six colours helped separate themes owners and open questions",
  "Long paragraphs shrink to fit the note but never spill past its bottom edge",
  "Dragging an idea next to a related one is how affinity mapping starts",
  "A duplicate note is gone with a single press of the delete key",
  "Double-clicking empty space turns a thought into a note before it escapes",
  "Owners wrote their names in the corner so follow up had a face to it",
  "The parking lot column kept three ideas that nobody could place yet",
  "Votes were counted by hand and one theme won by a single note",
  "Someone asked for a timer and the room agreed to keep the retro short",
  "Onboarding took days and everyone agreed that was worth fixing first",
  "A quiet person put up two notes that changed what the whole board was about",
];

/**
 * Realistic note text: between ten characters and `maxChars`, built from whole
 * sentences. A note of "aaaa" is a stress test, not a board.
 */
export function realisticText(
  rng: () => number,
  maxChars = STICKY_TEXT_MAX_CHARS,
): string {
  const minChars = 10;
  const target = Math.min(maxChars, STICKY_TEXT_MAX_CHARS);
  const wanted = minChars + Math.floor(rng() * (target - minChars));
  let text = "";
  while (text.length < wanted) {
    const sentence = SENTENCES[Math.floor(rng() * SENTENCES.length)];
    text += text.length === 0 ? sentence : ` ${sentence}`;
  }
  return text.slice(0, wanted);
}

/** Where a fixture note ended up, so a test can say what it expected. */
export interface PlacedNote {
  id: string;
  x: number;
  y: number;
  /** The text the note ends up holding, after any later rewrite here. */
  text: string;
  color: StickyColor;
}

/** A fixture board: the document, its notes, and the updates it went through. */
export interface BuiltBoard {
  readonly doc: Y.Doc;
  readonly notes: PlacedNote[];
  /**
   * Every transaction the board went through, oldest first — starting with the
   * schema transaction, because that is what a first client sends. These are the
   * rows a storage test writes, and what a websocket seeder replays.
   */
  readonly updates: Uint8Array[];
}

/**
 * Lay `count` notes out in loose columns. The first three are stacked at the
 * same spot: overlapping notes are the state where a lost or duplicated z order
 * shows up, and a fixture that never overlaps cannot catch it.
 */
function buildBoard(
  count: number,
  seed: number,
  maxTextChars: number,
): BuiltBoard {
  const rng = makeRng(seed);
  const doc = new Y.Doc({ gc: true });
  const updates: Uint8Array[] = [];
  doc.on("update", (update) => {
    updates.push(update.slice());
  });

  initDoc(doc);
  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const notes: PlacedNote[] = [];

  for (let index = 0; index < count; index += 1) {
    const stacked = index < 3;
    const x = stacked
      ? 40
      : 40 + Math.floor(index / 8) * 340 + Math.floor(rng() * 40);
    const y = stacked ? 40 : 40 + (index % 8) * 230 + Math.floor(rng() * 30);
    const color = COLOR_NAMES[Math.floor(rng() * COLOR_NAMES.length)];
    const text = stacked
      ? `Stacked note ${index + 1}`
      : realisticText(rng, maxTextChars);

    // One note, one transaction, one logged row: `updates[n + 1]` is then note
    // `n`, which is what lets a test say "damage the seventh row" and know
    // exactly what the board lost.
    let created: string | false = false;
    doc.transact(() => {
      created = createSticky(doc, { x, y });
      if (typeof created !== "string") return;
      const field = objects.get(created)?.get("text");
      if (!(field instanceof Y.Text))
        throw new Error(`board fixture lost the text of ${created}`);
      field.insert(0, text);
      if (color !== "yellow") setStickyColor(doc, created, color);
    });
    if (typeof created !== "string")
      throw new Error("the board fixture was refused a note");
    notes.push({ id: created, x, y, text, color });
  }

  return { doc, notes, updates };
}

/**
 * The 25-note retro board (design's storage fixture): mixed colours, multi-line
 * texts, and three notes stacked on top of one another.
 */
export function retroBoard(seed = 4): BuiltBoard {
  const built = buildBoard(25, seed, 240);
  const objects = built.doc.getMap<Y.Map<unknown>>("objects");
  for (const note of built.notes.slice(5, 9)) {
    const model = objects.get(note.id);
    const field = model?.get("text");
    if (!(field instanceof Y.Text)) continue;
    const multiline = `${field.toString().slice(0, 60)}\nsecond line of the item\nand a third`;
    // One transaction, so one update: "the seventh row" has to mean one thing.
    built.doc.transact(() => {
      field.delete(0, field.length);
      field.insert(0, multiline);
    });
    note.text = multiline;
  }
  return built;
}

/**
 * The board size the product is tested at (`PERSIST_TESTED_NOTES`): notes in
 * loose clusters, as a real board is organised.
 */
export function largeBoard(
  count = PERSIST_TESTED_NOTES,
  seed = 11,
  maxTextChars = STICKY_TEXT_MAX_CHARS,
): BuiltBoard {
  return buildBoard(count, seed, maxTextChars);
}

/** The board's notes, sorted by id: what "the same board" means in a test. */
export function notesOf(doc: Y.Doc): readonly StickySnapshot[] {
  return [...snapshot(doc)].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The ids of the board's notes, sorted. */
export function noteIds(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("objects").keys()].sort();
}

/**
 * A logged update with its last `cut` bytes removed — one of the two damaged
 * forms the design names. `Y.applyUpdate` throws on it (checked against the
 * yjs build in use), which is what makes the quarantine path real rather than a
 * story about a corrupt byte.
 */
export function truncatedUpdate(update: Uint8Array, cut = 10): Uint8Array {
  if (update.byteLength <= cut) {
    throw new Error(
      `update of ${update.byteLength} bytes is too small to cut by ${cut}`,
    );
  }
  return update.slice(0, update.byteLength - cut);
}

/**
 * The other damaged form: random bytes of the same length. Deterministic, so a
 * board with a quarantined row can be rebuilt exactly.
 */
export function randomBlob(length: number, seed = 5): Uint8Array {
  const rng = makeRng(seed);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1)
    bytes[index] = Math.floor(rng() * 256);
  return bytes;
}
