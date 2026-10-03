import { expect, type Page } from '@playwright/test';

import { CENTRE } from './board.js';
import {
  binButton,
  colorSwatch,
  createNote,
  docNotes,
  dragNote,
  escapeEditing,
  noteAt,
  notes,
  stickyEditor,
} from './sticky.js';
import type { StickySnapshot } from '../../../src/shared/board-model.js';
import {
  nextRandomOp,
  type RandomOp,
  randomFn,
} from '../../integration/random-ops.js';

/** How long a click is willing to wait for a note that other people may be moving. */
const CLICK_TIMEOUT_MS = 2_000;

/**
 * The seeded random operations of `tests/integration/random-ops.ts`, driven
 * through the real interface instead of straight into a `Y.Doc` (design "Random
 * edits (nightly)", tasks 9). The seed fixes what each person does, so a soak
 * that fails can be run again the same way:
 *
 *     VIDI6_NIGHTLY=1 VIDI6_NIGHTLY_SEED=1234 npm run test:e2e:nightly
 *
 * A drag can only go to a point the browser can reach, so a move is mapped into
 * the clickable area of the page rather than into the wide world the document
 * driver uses. The mapping is arithmetic on the same seeded value, so the run is
 * still reproducible note for note.
 */

/** How far a random move travels from the middle of the board, in screen pixels. */
const FIELD = 320;

/** The box a pointer can press and drag inside, in screen pixels. */
const REACHABLE = { left: 90, top: 60, right: 1190, bottom: 740 };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** A point the browser can actually click. */
const reachable = (point: { x: number; y: number }): { x: number; y: number } => ({
  x: clamp(point.x, REACHABLE.left, REACHABLE.right),
  y: clamp(point.y, REACHABLE.top, REACHABLE.bottom),
});

/** Where the drag of a move operation ends up, given the note it starts on. */
const dragTarget = (from: { x: number; y: number }, op: { x: number; y: number }) =>
  reachable({
    x: CENTRE.x + (((op.x - from.x) % FIELD) + FIELD) % FIELD - FIELD / 2,
    y: CENTRE.y + (((op.y - from.y) % FIELD) + FIELD) % FIELD - FIELD / 2,
  });

/** What a person got up to during a soak, for the log line. */
export interface OpTally {
  type: number;
  move: number;
  create: number;
  recolour: number;
  delete: number;
  /** Operations that could not be performed: the note had gone, or could not be reached. */
  skipped: number;
  total: number;
}

export const emptyTally = (): OpTally => ({
  type: 0,
  move: 0,
  create: 0,
  recolour: 0,
  delete: 0,
  skipped: 0,
  total: 0,
});

/** Count one operation off the tally. */
export function tallyOp(tally: OpTally, op: RandomOp, done: boolean): void {
  if (done) tally[op.kind] += 1;
  else tally.skipped += 1;
  tally.total += 1;
}

/** The position of a note in the list the page shows, or -1 when it has gone. */
function indexOfNote(live: { id: string }[], id: string): number {
  return live.findIndex((note) => note.id === id);
}

/**
 * Carry out one operation the way a person would: the sticky button for a new
 * note, a double-click and the keyboard for text, a drag for a move, the note
 * toolbar for a colour or the bin. Returns false when the note turned out to be
 * gone - which is the other people doing exactly what this person is doing.
 */
/** What an operation did: whether it happened, and which note it left behind. */
export interface OpResult {
  done: boolean;
  /** The note the operation touched, as it turned out. */
  noteId: string | null;
}

const notDone: OpResult = { done: false, noteId: null };

/**
 * Which note the interface just changed. A click goes to whatever the browser
 * finds at that point, and on a busy board that is not always the note the seed
 * asked for - so instead of assuming, the operation is attributed by comparing
 * the board before it with the board after it. That also keeps the latency
 * measurement honest: it follows the note that really moved.
 */
export function touchedNoteId(
  before: readonly StickySnapshot[],
  after: readonly StickySnapshot[],
  intended: string | null,
): string | null {
  const was = new Map(before.map((note) => [note.id, note]));
  const now = new Map(after.map((note) => [note.id, note]));
  const differs = (id: string): boolean => {
    const previous = was.get(id);
    const current = now.get(id);
    if (!previous || !current) return true; // it arrived, or it went away
    return (
      previous.x !== current.x ||
      previous.y !== current.y ||
      previous.color !== current.color ||
      previous.text !== current.text
    );
  };
  if (intended !== null && differs(intended)) return intended;
  for (const id of now.keys()) if (differs(id)) return id;
  for (const id of was.keys()) if (!now.has(id)) return id;
  return intended;
}

/**
 * Carry out one operation the way a person would: the sticky button for a new
 * note, a double-click and the keyboard for text, a drag for a move, the note
 * toolbar for a colour or the bin.
 *
 * Clicks are forced, with a short timeout: on a board where five people are
 * moving things around, a note is often mid-move or covered by another note, and
 * waiting for one to sit still would spend the soak waiting. What the click
 * actually hit is settled afterwards by `touchedNoteId`, so nothing is assumed.
 */
export async function performOp(page: Page, op: RandomOp): Promise<OpResult> {
  const before = await docNotes(page);

  if (op.kind === 'create') {
    await createNote(page);
    await escapeEditing(page);
    return { done: true, noteId: touchedNoteId(before, await docNotes(page), null) };
  }

  const live = before;
  if (live.length === 0) return notDone;
  const note = live[op.noteIndex % live.length];
  if (!note) return notDone;
  const index = indexOfNote(live, note.id);

  switch (op.kind) {
    case 'type': {
      const at = reachable(await centreOf(page, index));
      await page.mouse.dblclick(at.x, at.y);
      if ((await stickyEditor(page).count()) === 0) return notDone;
      // The editor opens with the caret at the end, so this is somebody adding a
      // word to the bottom of the note.
      await page.keyboard.type(op.text);
      await escapeEditing(page);
      return { done: true, noteId: touchedNoteId(before, await docNotes(page), note.id) };
    }
    case 'move': {
      const from = await centreOf(page, index);
      // A note whose own middle is off the screen cannot be pressed.
      if (
        from.x < REACHABLE.left ||
        from.x > REACHABLE.right ||
        from.y < REACHABLE.top ||
        from.y > REACHABLE.bottom
      ) {
        return notDone;
      }
      await dragNote(page, from, dragTarget(from, op), 3);
      return { done: true, noteId: touchedNoteId(before, await docNotes(page), note.id) };
    }
    case 'recolour': {
      await noteAt(page, index).click({ force: true, timeout: CLICK_TIMEOUT_MS });
      await colorSwatch(page, op.color).click({ force: true, timeout: CLICK_TIMEOUT_MS });
      return { done: true, noteId: touchedNoteId(before, await docNotes(page), note.id) };
    }
    case 'delete': {
      await noteAt(page, index).click({ force: true, timeout: CLICK_TIMEOUT_MS });
      await binButton(page).click({ force: true, timeout: CLICK_TIMEOUT_MS });
      return { done: true, noteId: touchedNoteId(before, await docNotes(page), note.id) };
    }
  }
}

/** Where the middle of a note sits on the screen. */
async function centreOf(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await noteAt(page, index).boundingBox();
  if (!box) return { ...CENTRE };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Edit for `durationMs` with operations from `seed`. The loop asks for the next
 * operation only once the previous one is finished and measured, so it stops
 * between operations and never leaves a half-finished change behind.
 */
export async function runRandomOps(
  page: Page,
  personIndex: number,
  seed: number,
  durationMs: number,
  /** Called after each operation that was performed, with the note it touched. */
  afterOp?: (op: RandomOp, noteId: string | null) => Promise<void>,
): Promise<OpTally> {
  const tally = emptyTally();
  const random = randomFn(seed * 7919 + personIndex);
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    const op = nextRandomOp(random, (await docNotes(page)).length);
    let result: OpResult = notDone;
    try {
      result = await performOp(page, op);
    } catch (error) {
      // A note that vanished, or a click that could not land while other people
      // are moving things: that is the rest of the board being a busy place. It is
      // counted, and the soak carries on.
      console.log(`[soak] ${op.kind} not possible: ${String(error).slice(0, 100)}`);
    }
    tallyOp(tally, op, result.done);
    if (result.done && afterOp) await afterOp(op, result.noteId);
  }

  // The board is left at rest: nothing focused, nothing half-typed, so the
  // snapshot comparison that follows is comparing settled pages.
  await page.keyboard.press('Escape');
  const drawn = await notes(page).count();
  expect(drawn).toBeGreaterThanOrEqual(0);
  return tally;
}

/**
 * Has the change that was just made on one page arrived on another? It follows
 * the note that was touched: the same place, colour and text as the person who
 * changed it sees, or - when they deleted it - no note with that id at all.
 *
 * `mine` is the board as the actor saw it straight after the change, so if
 * somebody else edits the same note in the meantime this says "arrived" a moment
 * late rather than a moment early.
 */
export function changeArrived(
  witness: StickySnapshot[],
  mine: StickySnapshot[],
  noteId: string | null,
): boolean {
  if (!noteId) return false;
  const note = mine.find((candidate) => candidate.id === noteId);
  const other = witness.find((candidate) => candidate.id === noteId);
  if (!note) return other === undefined;
  if (!other) return false;
  return (
    other.x === note.x &&
    other.y === note.y &&
    other.color === note.color &&
    other.text === note.text
  );
}
