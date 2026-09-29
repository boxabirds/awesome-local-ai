// Realistic board generators for the persistence tests. Every byte here comes
// from the real `board-model` mutations, so the fixtures are real Yjs updates —
// nothing is hand-written Yjs binary.
//
// Each generated update is *self-contained*: one note per fresh `Y.Doc` (so per
// fresh client id), which is how a board that 25 people each added a note to is
// actually stored. Self-contained rows are what make the damage tests mean what
// they say: quarantining one row loses exactly that one change and nothing else.
//
// `largeBoardDoc` is the exception: it builds the whole big board in one client /
// one transaction, because seeding an e2e board row-by-row over a socket would
// measure the seed rather than the load.

import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.ts';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config.ts';

/** The parts of a note a test cares about, in rendering (stacking) order. */
export interface NoteSpec {
  text: string;
  color: StickyColor;
  x: number;
  y: number;
  z: number;
}

export interface BoardFixture {
  /** One Yjs update per update-log row, in the order they were written. */
  updates: Uint8Array[];
  /** The board those updates must produce, sorted by stacking order. */
  expected: readonly NoteSpec[];
  /**
   * The sticky id of each note in `expected` order, so a test can point at one
   * note without depending on the text it carries.
   */
  stickyIds: readonly string[];
}

/** Deterministic PRNG (mulberry32) so a failing run is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS: string[] = [
  'What went well: we shipped the migration ahead of schedule.',
  'What to improve: review turnaround was slow mid-sprint.',
  'Action: rotate a dedicated reviewer each week.',
  'Ship-day snacks were a genuine morale feature and should stay in the budget.',
  'Onboarding docs were wrong twice in one week; nobody noticed for four days.',
  'The handoff from design to build finally stopped losing the edge cases we had agreed on.',
  'Pairing on the storage migration paid for itself in the first two days.',
  'Our incident channel is noisy enough that real alerts get missed.',
  'Try: freeze the release train on Fridays and see whether the panic disappears.',
  'The migration dry-run caught the bad rows, which is exactly what a dry-run is for.',
  'Sprint scope kept growing after the forecast was signed; the plan stopped being real.',
  'Everyone said the retro was useful and then nobody read the notes afterwards.',
  'Docs: publish the runbook where the on-call engineer will actually look at 3am.',
  'Great: zero data loss in the canary and the rollback took under a minute.',
  'The new board replaced three spreadsheets and people noticed within a day.',
  'Ask the platform team for a read replica before the next import week.',
  'Investigation: why does the import job still depend on last year’s export format?',
  'We cut the p95 open time in half by batching the reads instead of looping them.',
  'Reminder: the archive is readable by anyone who guesses the address; fix before launch.',
  'Keep the demo under ten minutes and let the notes carry the detail instead.',
  'Try a written first-review comment before the call; the call got long again.',
  'The colour legend saved us from six questions about what each column means.',
  'Blocking: the shared credential expires on Sunday and nobody owns renewing it.',
  'Thank you to whoever rewrote the flaky timing test; the red build stopped lying.',
  'Follow-up: measure the open time on a real phone, not only on the laptops in this room.',
];

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length) % xs.length]!;
}

/** A cluster grid so a large board looks like a real, grouped board. */
function clusterPoint(rand: () => number, index: number): { x: number; y: number } {
  const perCluster = 40;
  const cluster = Math.floor(index / perCluster);
  const inCluster = index % perCluster;
  const cx = (cluster % 10) * 2600;
  const cy = Math.floor(cluster / 10) * 2600;
  const col = inCluster % 8;
  const row = Math.floor(inCluster / 8);
  return {
    x: cx + col * (STICKY_SIZE_WORLD + 24) + Math.round(rand() * 18),
    y: cy + row * (STICKY_SIZE_WORLD + 24) + Math.round(rand() * 18),
  };
}

const PHRASE_SENTENCES = [
  'The team agreed to pilot the new onboarding flow with a small group first. ',
  'Clear ownership of each stage reduced handoff delays across the squad. ',
  'We collected feedback every Friday and folded it straight into the next iteration. ',
  'Documentation stayed current because updates shipped with the code review. ',
  'Small, frequent releases made problems easier to spot and cheaper to fix. ',
  'Everyone kept the shared board tidy by grouping related ideas into clusters. ',
  'The migration ran twice overnight and both runs finished inside the window. ',
  'Ask for the numbers before the meeting so the argument is about causes. ',
  'Notes from the customer calls were grouped by theme rather than by date. ',
  'Rollback instructions were tested on a staging copy before anything shipped. ',
];

/** Realistic English prose of exactly `len` characters (10-300 in practice). */
export function realisticText(len: number): string {
  let out = '';
  let i = 0;
  while (out.length < len) {
    out += PHRASE_SENTENCES[i % PHRASE_SENTENCES.length];
    i++;
  }
  return out.slice(0, len);
}

/**
 * One self-contained update creating one note: `at` is the note's top-left world
 * position, `z` its stacking level. Written by a fresh client so the row applies
 * on its own, in any order and with any other row missing.
 */
function noteUpdate(spec: NoteSpec): { bytes: Uint8Array; id: string } {
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let id = '';
  doc.transact(() => {
    id = createSticky(
      doc,
      { x: spec.x + STICKY_SIZE_WORLD / 2, y: spec.y + STICKY_SIZE_WORLD / 2 },
      spec.color,
    );
    const o = objects.get(id)!;
    (o.get('text') as Y.Text).insert(0, spec.text);
    // The generated stacking order is the fixture's, not creation order.
    o.set('z', spec.z);
  });
  return { bytes: Y.encodeStateAsUpdate(doc), id };
}

/** Assemble a board document from updates (the reference for "as it was left"). */
export function docFromUpdates(updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

/** Board fields of a snapshot, in stacking order (ids and timestamps excluded). */
export function specsOf(notes: readonly StickySnapshot[]): NoteSpec[] {
  return notes.map((n) => ({ text: n.text, color: n.color, x: n.x, y: n.y, z: n.z }));
}

/** Compare a loaded board against the specs it was written from. */
export function specsMatch(
  notes: readonly StickySnapshot[],
  expected: readonly NoteSpec[],
): boolean {
  if (notes.length !== expected.length) return false;
  const a = specsOf(notes);
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = expected[i]!;
    if (x.text !== y.text || x.color !== y.color || x.x !== y.x || x.y !== y.y || x.z !== y.z) {
      return false;
    }
  }
  return true;
}

/**
 * Build a board from `specs` in ONE client and ONE transaction (fast seeding for
 * e2e: one SyncStep2 instead of thousands of rows).
 */
export function boardDocFromSpecs(specs: readonly NoteSpec[]): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  Y.transact(doc, () => {
    for (const spec of specs) {
      const id = createSticky(
        doc,
        { x: spec.x + STICKY_SIZE_WORLD / 2, y: spec.y + STICKY_SIZE_WORLD / 2 },
        spec.color,
      );
      const o = objects.get(id)!;
      if (spec.text) (o.get('text') as Y.Text).insert(0, spec.text);
      o.set('z', spec.z);
    }
  });
  return doc;
}

function build(updates: Uint8Array[], specs: NoteSpec[], stickyIds: readonly string[]): BoardFixture {
  // Sanity: the fixture's own bytes must reproduce its own expectations.
  const assembled = snapshot(docFromUpdates(updates));
  if (!specsMatch(assembled, specs)) {
    throw new Error('board fixture does not reproduce its expected specs');
  }
  if (assembled.some((n, i) => n.id !== stickyIds[i])) {
    throw new Error('board fixture ids do not line up with its specs');
  }
  return { updates, expected: specs, stickyIds };
}

/**
 * The same 25 notes plus `editCount` follow-up edits — nudges and colour changes
 * made through the real `moveObject` / `setStickyColor` mutations, one update per
 * edit. This is what a board that was worked on for a while looks like in the log:
 * few notes, many rows (`retroBoardWithEdits(474)` = exactly
 * COMPACTION_UPDATE_COUNT rows for 25 notes).
 */
export function retroBoardWithEdits(editCount: number, seed = 5150): BoardFixture {
  const base = retroBoard(seed);
  const doc = docFromUpdates(base.updates);
  const rand = seededRandom(seed + 17);
  // Current board state, kept in step with the edits so `expected` is derived
  // from the fixture's own intentions rather than from reading the doc back.
  const specs = specsOf(snapshot(doc));

  let captured: Uint8Array[] | null = null;
  doc.on('update', (update: Uint8Array) => {
    if (captured) captured.push(update);
  });

  const edits: Uint8Array[] = [];
  for (let i = 0; i < editCount; i++) {
    const noteIndex = i % base.stickyIds.length;
    const id = base.stickyIds[noteIndex]!;
    const spec = specs[noteIndex]!;
    captured = [];
    if (i % 2 === 0) {
      spec.x += 4 + Math.floor(rand() * 40);
      spec.y += 2 + Math.floor(rand() * 30);
      if (!moveObject(doc, id, spec.x, spec.y)) throw new Error('fixture move rejected');
    } else {
      const color = COLOR_NAMES[(i + noteIndex + 1) % COLOR_NAMES.length]!;
      spec.color = color;
      if (!setStickyColor(doc, id, color)) throw new Error('fixture recolour rejected');
    }
    for (const update of captured) edits.push(update);
    captured = null;
    if (edits.length !== i + 1) throw new Error('fixture edit produced no update');
  }

  const expected = specs.slice().sort((a, b) => a.z - b.z);
  return build([...base.updates, ...edits], expected, base.stickyIds);
}

/**
 * The 25-note retrospective board of PRD `persist.reopen`: mixed colours,
 * multi-line texts and an overlapping, deliberately shuffled stacking order.
 */
export function retroBoard(seed = 20260929): BoardFixture {
  const rand = seededRandom(seed);
  const specs: NoteSpec[] = [];
  for (let i = 0; i < 25; i++) {
    const cluster = i % 5;
    const base = RETRO_TEXTS[i]!;
    // Every third note carries a second line, so multi-line text is exercised.
    const text = i % 3 === 0 ? `${base}\nFollow-up owner: the whole squad.` : base;
    specs.push({
      text,
      color: COLOR_NAMES[i % COLOR_NAMES.length]!,
      // Deliberate overlaps: notes in a cluster share most of their area.
      x: cluster * 900 + (i % 3) * 60,
      y: 120 + Math.floor(i / 5) * 70,
      z: 0, // filled below: shuffled stacking order
    });
  }
  // A stacking order that is neither creation order nor position order.
  const order = specs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  order.forEach((specIndex, stacking) => {
    specs[specIndex]!.z = stacking + 1;
  });
  specs.sort((a, b) => a.z - b.z);

  const updates: Uint8Array[] = [];
  const stickyIds: string[] = [];
  // Row 0 is the schema meta write, exactly as a real client board starts.
  {
    const metaDoc = new Y.Doc();
    initDoc(metaDoc);
    updates.push(Y.encodeStateAsUpdate(metaDoc));
  }
  for (const spec of specs) {
    const note = noteUpdate(spec);
    updates.push(note.bytes);
    stickyIds.push(note.id);
  }
  return build(updates, specs, stickyIds);
}

/**
 * A board of `count` (default PERSIST_TESTED_NOTES) notes with realistic English
 * phrases of 10-300 characters, laid out in clusters — the size PRD
 * `persist.large_board` guarantees an open time for.
 */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 777): BoardFixture {
  const rand = seededRandom(seed);
  const specs: NoteSpec[] = [];
  for (let i = 0; i < count; i++) {
    const p = clusterPoint(rand, i);
    const len = 10 + Math.floor(rand() * 291); // 10..300 characters
    specs.push({ text: realisticText(len), color: pick(rand, COLOR_NAMES), x: p.x, y: p.y, z: i + 1 });
  }
  const updates: Uint8Array[] = [];
  const stickyIds: string[] = [];
  {
    const metaDoc = new Y.Doc();
    initDoc(metaDoc);
    updates.push(Y.encodeStateAsUpdate(metaDoc));
  }
  for (const spec of specs) {
    const note = noteUpdate(spec);
    updates.push(note.bytes);
    stickyIds.push(note.id);
  }
  return build(updates, specs, stickyIds);
}

/** The large board as one fast document, for seeding a room over a socket. */
export function largeBoardSpecs(count: number = PERSIST_TESTED_NOTES, seed = 777): NoteSpec[] {
  const rand = seededRandom(seed);
  const specs: NoteSpec[] = [];
  for (let i = 0; i < count; i++) {
    const p = clusterPoint(rand, i);
    const len = 10 + Math.floor(rand() * 291);
    specs.push({ text: realisticText(len), color: pick(rand, COLOR_NAMES), x: p.x, y: p.y, z: i + 1 });
  }
  return specs;
}

/**
 * One update per group of notes — what the log holds when someone pastes a group
 * in a single action. Used to cross the byte compaction threshold while staying
 * below the row-count threshold.
 */
export function batchedNoteUpdates(
  batches: readonly (readonly NoteSpec[])[],
): Uint8Array[] {
  return batches.map((batch) => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    Y.transact(doc, () => {
      for (const spec of batch) {
        const id = createSticky(
          doc,
          { x: spec.x + STICKY_SIZE_WORLD / 2, y: spec.y + STICKY_SIZE_WORLD / 2 },
          spec.color,
        );
        const o = objects.get(id)!;
        if (spec.text) (o.get('text') as Y.Text).insert(0, spec.text);
        o.set('z', spec.z);
      }
    });
    return Y.encodeStateAsUpdate(doc);
  });
}

// ---- damaged-byte fixtures -------------------------------------------------

/** A real update with its tail cut off: Yjs throws when it cannot decode it. */
export function truncatedUpdate(update: Uint8Array, dropBytes = 10): Uint8Array {
  return update.slice(0, Math.max(1, update.length - dropBytes));
}

/** Random bytes of the same length as `update` (the other damage shape). */
export function randomBytesLike(update: Uint8Array, seed = 4242): Uint8Array {
  const rand = seededRandom(seed);
  const out = new Uint8Array(update.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}
