import { expect, test } from "@playwright/test";
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from "../../src/shared/config";
import * as notes from "./helpers/notes";
import * as selection from "./helpers/selection";
import {
  expectEventually,
  expectNoProblems,
  openSession,
  reportLatencies,
  resetLatencies,
  type Session,
} from "./helpers/participants";
import { centreOn, createNotes, marquee, selectionState } from "./helpers/selection";

/**
 * Story 7, task 5 (TC-35) — a colleague deletes one of my selected notes.
 *
 * The selection is this screen's own view state, so the only thing that can take
 * an object out of it is the board itself. Two real browsers, one board, one real
 * WebSocket: Sam deletes a note Lee has selected, and Lee's selection has to
 * notice without Lee touching anything.
 */

/** A 5 x 4 board: 20 notes, centres 250 board units apart. */
const COLUMNS = [150, 400, 650, 900, 1150];
const ROWS = [150, 400, 650, 900];
const CAMERA = { x: 650, y: 525, zoom: 0.5 };

test.describe("TC-35 a colleague deletes one of my selected notes", () => {
  test("the selection drops it, the bar re-counts, and the rest of the selection still works", async ({
    browser,
  }) => {
    resetLatencies();
    const session: Session = await openSession(browser, ["Lee", "Sam"]);
    const lee = session.participants[0]!.page;
    const sam = session.participants[1]!.page;

    try {
      // Both screens look at the board from the same place, so a note Lee has
      // selected is somewhere Sam can click it.
      for (const page of [lee, sam]) {
        await centreOn(page, { x: CAMERA.x, y: CAMERA.y }, CAMERA.zoom);
        await notes.settle(page);
      }

      const grid = await createNotes(
        lee,
        ROWS.flatMap((y) => COLUMNS.map((x) => ({ x, y }))),
      );
      expect(grid).toHaveLength(20);
      await expect.poll(() => notes.noteCount(sam)).toBe(20);

      // Lee Shift+drags a rectangle that encloses exactly four notes: the first
      // row's first four. The fifth sticks out, and the second row is below it.
      await marquee(lee, { x: 0, y: 0 }, { x: 1020, y: 280 });
      const leeSelection = await selectionState(lee);
      expect(leeSelection.selected).toBe(4);
      expect(leeSelection.count).toBe("4 selected");
      // The board does not promise an order for a selection, only its members.
      expect((await selection.selectedIds(lee)).sort()).toEqual(
        [grid[0], grid[1], grid[2], grid[3]].sort(),
      );

      // Sam picks one of those four and deletes it.
      const deleted = grid[1]!;
      await sam.locator(`[data-note-id='${deleted}']`).click();
      await sam.keyboard.press("Delete");

      // On Lee's screen the note is gone and the selection followed it there.
      const tookMs = await expectEventually(
        "TC-35 remote delete prunes the selection",
        async () => {
          const state = await selectionState(lee);
          const ids = await selection.selectedIds(lee);
          return state.count === "3 selected" && !ids.includes(deleted) && ids.length === 3;
        },
        LIVE_UPDATE_LATENCY_BUDGET_MS,
      );
      expect(tookMs).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);

      const after = await selectionState(lee);
      expect(after.selected).toBe(3);
      expect(after.outlines).toBe(3);
      expect(after.bar).toBe(true);
      // The remaining three are still the ones Lee selected.
      expect((await selection.selectedIds(lee)).sort()).toEqual(
        [grid[0], grid[2], grid[3]].sort(),
      );
      expect(await notes.noteCount(lee)).toBe(19);
      expect(await notes.noteCount(sam)).toBe(19);

      // Lee deletes what is left of the selection: exactly those three.
      await lee.keyboard.press("Delete");
      await notes.settle(lee);
      await expect
        .poll(async () => (await selectionState(lee)).selected)
        .toBe(0);
      expect(await notes.noteCount(lee)).toBe(16);
      // Sam's screen is the far end of the room, and it is a background tab, whose
      // painting a browser is allowed to defer. So it is brought forward and the
      // three deletions are *waited for* — the count is asserted the moment it is
      // true, and the waiting is what is measured, exactly as the single remote
      // delete above is.
      await sam.bringToFront();
      const samSawThemAfterMs = await expectEventually(
        "TC-35 Sam sees Lee's deletions",
        async () => (await notes.noteCount(sam)) === 16,
        LIVE_UPDATE_LATENCY_BUDGET_MS,
      );
      expect(samSawThemAfterMs).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);
      expect((await selectionState(lee)).bar).toBe(false);

      // Nothing Sam or Lee never saw: Sam's own selection is his business.
      expect((await selectionState(sam)).selected).toBe(0);
      expectNoProblems(session.participants);
      reportLatencies();
    } finally {
      await session.close();
    }
  });

  test("a note deleted by a colleague also ends the editing of a selected note", async ({ browser }) => {
    const session: Session = await openSession(browser, ["Lee", "Sam"]);
    const lee = session.participants[0]!.page;
    const sam = session.participants[1]!.page;
    try {
      for (const page of [lee, sam]) await centreOn(page, { x: 420, y: 300 }, 1);
      const [a, b] = await createNotes(lee, [
        { x: 250, y: 250 },
        { x: 600, y: 250 },
      ]);
      await marquee(lee, { x: 50, y: 50 }, { x: 820, y: 450 });
      expect((await selectionState(lee)).selected).toBe(2);

      // Lee is typing into one of them when Sam deletes the other.
      await lee.locator(`[data-note-id='${a}']`).dblclick();
      await lee.keyboard.type("half written");
      await expect(lee.getByTestId("sticky-note-input")).toHaveValue("half written");

      await sam.locator(`[data-note-id='${b}']`).click();
      await sam.keyboard.press("Delete");

      await expect.poll(() => notes.noteCount(lee)).toBe(1);
      const state = await selectionState(lee);
      expect(state.selected).toBe(1);
      expect(await selection.selectedIds(lee)).toEqual([a]);
      // Lee is still writing where Lee was writing.
      await expect(lee.getByTestId("sticky-note-input")).toHaveValue("half written");
      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});
