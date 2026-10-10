/**
 * Test-only board seeding (story 4's e2e, TC-19 to TC-21).
 *
 * A browser e2e test needs a board of a *known* size — 25 notes to come back to
 * after a restart, `PERSIST_TESTED_NOTES` to open — and the only way to make one
 * that means anything is to make it the way a board is made: the real functions
 * from `src/shared/board-model.ts`, on the live document, so every note leaves
 * this client as a real Yjs update and travels over the real socket to the room,
 * which stores it as it stores anything else. A fixture pasted into storage
 * would skip the part of the product the test is about.
 *
 * One note, one transaction, one update — the same shape `tests/fixtures/boards.ts`
 * builds in, and the reason a test can say "the seventh row" and mean it. The
 * caller decides where notes go and what they say; this only refuses to invent
 * either.
 */
import * as Y from "yjs";

import {
  createSticky,
  getStickyText,
  setStickyColor,
} from "../shared/board-model";
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from "../shared/config";

/**
 * Where a seeded note goes, what it says, and what colour it says it in.
 * `x`/`y` are the note's top-left corner in board units — the same numbers the
 * board stores and the screen reports in `data-x`. A note dropped by hand is
 * dropped by its centre, which is what `createSticky` is given, so the
 * conversion happens here: a test that says "the note is at 40,40" gets one
 * whose `data-x` is 40.
 */
export interface SeedNote {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly text: string;
}

/**
 * Create `notes` on `doc` and answer with the ids, in order. Throws if the board
 * model refuses a note or a colour: a seeder that quietly skipped one would make
 * "all 2,000 notes are here" a lie about the seeder rather than about the board.
 */
export function seedBoard(doc: Y.Doc, notes: readonly SeedNote[]): string[] {
  const created: string[] = [];
  for (const note of notes) {
    if (!isColor(note.color)) {
      throw new Error(
        `seeder was asked for colour ${JSON.stringify(note.color)}`,
      );
    }
    const centre = { x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 };
    let id: string | false = false;
    doc.transact(() => {
      id = createSticky(doc, centre);
      if (typeof id !== "string") return;
      const text = getStickyText(doc, id);
      if (!text) throw new Error(`the board lost the text of ${id}`);
      if (note.text.length > 0) text.insert(0, note.text);
      if (note.color !== "yellow") setStickyColor(doc, id, note.color);
    });
    if (typeof id !== "string")
      throw new Error(`the board refused a note at ${note.x},${note.y}`);
    created.push(id);
  }
  return created;
}

const ALL_COLORS: ReadonlySet<string> = new Set(Object.keys(STICKY_COLORS));

const isColor = (value: string): value is StickyColor => ALL_COLORS.has(value);
