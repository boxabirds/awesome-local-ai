import { expect, test } from "@playwright/test";
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import { PROSE_1200, RETRO_TEXT } from "../fixtures/texts";
import * as board from "./helpers/board";
import * as notes from "./helpers/notes";

/**
 * TC-30 - TC-38: sticky note workflows end to end. Every test ends by reading
 * the board model in the page, because that is what story 3 will sync and
 * story 4 will save.
 */

const PIXEL_TOLERANCE = 1;

function within(value: number, target: number, tolerance = PIXEL_TOLERANCE) {
  return Math.abs(value - target) <= tolerance;
}

test.beforeEach(async ({ page }) => {
  await board.openBoard(page);
  await notes.openBoard(page);
});

test.describe("creating a note (TC-30, TC-28)", () => {
  test("TC-30: double-click at (400,300) then type 'Hello' gives a note centred there", async ({
    page,
  }) => {
    const point = { x: 400, y: 300 };
    const id = await notes.createNoteByDoubleClick(page, point);

    const box = await notes.noteBox(page, id);
    expect(within(box.x + box.width / 2, point.x)).toBe(true);
    expect(within(box.y + box.height / 2, point.y)).toBe(true);
    expect(within(box.width, STICKY_SIZE_WORLD)).toBe(true);
    expect(within(box.height, STICKY_SIZE_WORLD)).toBe(true);

    // Ready to type immediately.
    await notes.expectEditing(page, id, true);
    await expect(page.getByTestId("sticky-textarea")).toBeFocused();

    await page.keyboard.type("Hello");
    await page.keyboard.press("Escape");

    expect(await notes.noteText(page, id)).toBe("Hello");
    expect((await notes.noteBox(page, id)).id).toBe(id);
    await expect(page.getByTestId("sticky-textarea")).toHaveCount(0);
  });

  test("the Sticky note button creates one centred on the visible board area", async ({ page }) => {
    const centre = await board.boardCentre(page);
    const id = await notes.createNoteByButton(page);

    const box = await notes.noteBox(page, id);
    expect(within(box.x + box.width / 2, centre.x)).toBe(true);
    expect(within(box.y + box.height / 2, centre.y)).toBe(true);
    expect(await notes.noteCount(page)).toBe(1);

    await expect(page.getByTestId("sticky-textarea")).toBeFocused();
  });

  test("the board centre is where the world origin is at 100% zoom", async ({ page }) => {
    const centre = await board.boardCentre(page);
    const id = await notes.createNoteByButton(page);
    const [note] = await notes.modelNotes(page);

    expect(note!.id).toBe(id);
    expect(within(note!.x + STICKY_SIZE_WORLD / 2, 0, 0.5)).toBe(true);
    expect(within(note!.y + STICKY_SIZE_WORLD / 2, 0, 0.5)).toBe(true);
    expect(within((await notes.noteBox(page, id)).x + STICKY_SIZE_WORLD / 2, centre.x, 1)).toBe(true);
  });
});

test.describe("double-click on an existing note (TC-35)", () => {
  test("edits that note and does not create another one", async ({ page }) => {
    const point = { x: 640, y: 320 };
    const id = await notes.createNoteByDoubleClick(page, point);
    await page.keyboard.type("existing idea");
    await notes.closeEditor(page, "escape");

    const box = await notes.noteBox(page, id);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByTestId("sticky-textarea")).toBeVisible();
    await expect(page.getByTestId("sticky-textarea")).toHaveValue("existing idea");
    expect(await notes.noteCount(page)).toBe(1);
    expect(await notes.noteText(page, id)).toBe("existing idea");

    // The caret starts at the end of the text, so typing appends.
    await page.keyboard.type(" more");
    await page.keyboard.press("Escape");
    expect(await notes.noteText(page, id)).toBe("existing idea more");
  });
});

test.describe("Enter on a selected note (TC-23, TC-36)", () => {
  test("TC-23: Enter starts editing the selected note with the caret at the end", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 400, y: 260 });
    await page.keyboard.type("Hello");
    await notes.closeEditor(page, "escape");

    await notes.selectNote(page, id);
    await page.keyboard.press("Enter");

    await notes.expectEditing(page, id, true);
    const area = page.getByTestId("sticky-textarea");
    await expect(area).toBeFocused();
    const caret = await area.evaluate((el: HTMLTextAreaElement) => ({
      length: el.value.length,
      start: el.selectionStart,
      end: el.selectionEnd,
    }));
    expect(caret.start).toBe(caret.length);
    expect(caret.end).toBe(caret.length);
  });

  test("does nothing when no note is selected", async ({ page }) => {
    await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "outside");
    expect(await notes.noteCount(page)).toBe(1);

    await page.keyboard.press("Enter");

    expect(await notes.noteCount(page)).toBe(1);
    await expect(page.getByTestId("sticky-textarea")).toHaveCount(0);
  });
});

test.describe("selecting a note (TC-18, TC-22, TC-38)", () => {
  test("a click selects: outline and toolbar; clicking empty board clears both", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");

    // While editing there is no toolbar; after Escape the selected note has one.
    await notes.expectSelected(page, id, true);
    await expect(page.getByTestId("note-toolbar")).toBeVisible();

    await notes.clickEmptyBoard(page);
    await notes.expectSelected(page, id, false);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);

    await notes.selectNote(page, id);
    await notes.expectSelected(page, id, true);
  });

  test("clicking another note moves the selection to it", async ({ page }) => {
    const first = await notes.createNoteByDoubleClick(page, { x: 450, y: 250 });
    await notes.closeEditor(page, "outside");
    const second = await notes.createNoteByDoubleClick(page, { x: 850, y: 450 });
    await notes.closeEditor(page, "outside");

    await notes.selectNote(page, first);
    await notes.selectNote(page, second);

    await notes.expectSelected(page, first, false);
    await notes.expectSelected(page, second, true);
  });

  test("typing then clicking outside commits the text and leaves the note unselected (TC-38)", async ({
    page,
  }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await page.keyboard.type("abc");

    await notes.clickEmptyBoard(page);
    await expect(page.getByTestId("sticky-textarea")).toHaveCount(0);

    expect(await notes.noteText(page, id)).toBe("abc");
    await notes.expectSelected(page, id, false);
  });
});

test.describe("dragging a note (TC-19, TC-20)", () => {
  test("2 px of movement is not a drag", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);
    await notes.selectNote(page, id);

    const before = await notes.modelNotes(page);
    const box = await notes.noteBox(page, id);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (DRAG_THRESHOLD_PX - 1), box.y + box.height / 2);
    await page.mouse.up();

    const after = await notes.modelNotes(page);
    expect(after[0]).toMatchObject({ x: before[0]!.x, y: before[0]!.y, z: before[0]!.z });
  });

  test("3 px of movement drags the note, one screen pixel per board unit at 100% zoom", async ({
    page,
  }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);

    const before = (await notes.modelNotes(page))[0]!;
    const boxBefore = await notes.noteBox(page, id);

    await notes.dragNote(page, id, DRAG_THRESHOLD_PX, 0);

    const after = (await notes.modelNotes(page))[0]!;
    expect(after.x - before.x).toBeCloseTo(DRAG_THRESHOLD_PX, 1);
    expect(after.y - before.y).toBeCloseTo(0, 1);

    // The grabbed point stayed under the pointer, and the board did not pan.
    const boxAfter = await notes.noteBox(page, id);
    expect(within(boxAfter.x - boxBefore.x, DRAG_THRESHOLD_PX)).toBe(true);
    expect(await board.readCamera(page)).toEqual(await board.renderedCamera(page));
  });

  test("dragging never pans the board", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);

    const cameraBefore = await board.readCamera(page);
    await notes.dragNote(page, id, 180, 120);

    const cameraAfter = await board.readCamera(page);
    expect(cameraAfter.x).toBeCloseTo(cameraBefore.x, 6);
    expect(cameraAfter.y).toBeCloseTo(cameraBefore.y, 6);
    expect(cameraAfter.zoom).toBeCloseTo(cameraBefore.zoom, 6);
  });

  test("a dragged note is drawn above the note it overlaps (TC-32)", async ({ page }) => {
    const stationary = await notes.createNoteByDoubleClick(page, { x: 500, y: 300 });
    await notes.closeEditor(page, "outside");
    const dragged = await notes.createNoteByDoubleClick(page, { x: 900, y: 520 });
    await notes.closeEditor(page, "outside");

    const stationaryBox = await notes.noteBox(page, stationary);
    const draggedBox = await notes.noteBox(page, dragged);
    // Move the dragged note's centre onto the stationary note's centre, offset
    // a little so the two still overlap by a clear margin.
    const dx = stationaryBox.x + stationaryBox.width / 2 - (draggedBox.x + draggedBox.width / 2) - 40;
    const dy = stationaryBox.y + stationaryBox.height / 2 - (draggedBox.y + draggedBox.height / 2) - 40;
    await notes.dragNote(page, dragged, dx, dy);

    // Paint order in the model and in the DOM: the dragged note is on top.
    const modelOrder = (await notes.modelNotes(page)).map((note) => note.id);
    expect(modelOrder[modelOrder.length - 1]).toBe(dragged);

    const zDragged = (await notes.noteBox(page, dragged)).zIndex;
    const zStationary = (await notes.noteBox(page, stationary)).zIndex;
    expect(zDragged).toBeGreaterThan(zStationary);

    // Where they overlap, the topmost element belongs to the dragged note.
    const overlap = {
      x: stationaryBox.x + stationaryBox.width / 2,
      y: stationaryBox.y + stationaryBox.height / 2,
    };
    const topId = await page.evaluate((point) => {
      const element = document.elementFromPoint(point.x, point.y);
      return element?.closest<HTMLElement>("[data-testid='sticky-note']")?.dataset.noteId ?? null;
    }, overlap);
    expect(topId).toBe(dragged);
  });
});

test.describe("dragging at other zoom levels (TC-31, TC-32)", () => {
  test("TC-31 at 50%: a 100 x 50 px drag moves the note +200, +100 board units under the pointer", async ({
    page,
  }) => {
    await notes.zoomTo(page, 0.5);

    const id = await notes.createNoteByButton(page);
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);

    const box = await notes.noteBox(page, id);
    expect(within(box.width, notes.expectedScreenSize(0.5), 1.5)).toBe(true);
    expect(within(box.height, notes.expectedScreenSize(0.5), 1.5)).toBe(true);

    const before = (await notes.modelNotes(page))[0]!;
    await notes.dragNote(page, id, 100, 50);
    const after = (await notes.modelNotes(page))[0]!;

    expect(after.x - before.x).toBeCloseTo(200, 1);
    expect(after.y - before.y).toBeCloseTo(100, 1);

    // The grabbed point stayed under the pointer.
    const moved = await notes.noteBox(page, id);
    expect(within(moved.x - box.x, 100, 1.5)).toBe(true);
    expect(within(moved.y - box.y, 50, 1.5)).toBe(true);
  });

  test("TC-32 at 200%: a 100 x 50 px drag moves the note +50, +25 and puts it above a note it overlaps", async ({
    page,
  }) => {
    await notes.zoomTo(page, 2);

    const id = await notes.createNoteByButton(page);
    await notes.closeEditor(page, "escape");
    const other = await notes.createNoteByDoubleClick(page, { x: 300, y: 260 });
    await notes.closeEditor(page, "outside");

    const box = await notes.noteBox(page, id);
    expect(within(box.width, notes.expectedScreenSize(2), 1.5)).toBe(true);

    const before = (await notes.modelNotes(page)).find((note) => note.id === id)!;
    await notes.dragNote(page, id, 100, 50);
    const after = (await notes.modelNotes(page)).find((note) => note.id === id)!;
    expect(after.x - before.x).toBeCloseTo(50, 1);
    expect(after.y - before.y).toBeCloseTo(25, 1);

    // Now move it onto the other note: it must be drawn on top.
    const otherBox = await notes.noteBox(page, other);
    const draggedBox = await notes.noteBox(page, id);
    await notes.dragNote(
      page,
      id,
      otherBox.x - draggedBox.x,
      otherBox.y - draggedBox.y,
    );

    const modelOrder = (await notes.modelNotes(page)).map((note) => note.id);
    expect(modelOrder[modelOrder.length - 1]).toBe(id);
    expect((await notes.noteBox(page, id)).zIndex).toBeGreaterThan(
      (await notes.noteBox(page, other)).zIndex,
    );

    const overlap = { x: otherBox.x + 80, y: otherBox.y + 80 };
    const topId = await page.evaluate((point) => {
      const element = document.elementFromPoint(point.x, point.y);
      return element?.closest<HTMLElement>("[data-testid='sticky-note']")?.dataset.noteId ?? null;
    }, overlap);
    expect(topId).toBe(id);
  });
});

test.describe("brainstorm golden path (TC-30, TC-31, TC-27, TC-25)", () => {
  test("capture three ideas, move one, recolour it, delete another", async ({ page }) => {
    // Two ideas by double-click, one by the toolbar button.
    const first = await notes.createNoteByDoubleClick(page, { x: 300, y: 300 });
    await page.keyboard.type(RETRO_TEXT);
    await notes.closeEditor(page, "escape");

    const second = await notes.createNoteByDoubleClick(page, { x: 900, y: 300 });
    await page.keyboard.type("Ship on Friday");
    await notes.closeEditor(page, "outside");

    const third = await notes.createNoteByButton(page);
    await page.keyboard.type("Blockers");
    await notes.closeEditor(page, "outside");

    expect(await notes.noteCount(page)).toBe(3);

    // Rearrange: move the first idea to the right and down.
    const before = (await notes.modelNotes(page)).find((note) => note.id === first)!;
    await notes.dragNote(page, first, 150, -90);
    const moved = (await notes.modelNotes(page)).find((note) => note.id === first)!;
    expect(moved.x - before.x).toBeCloseTo(150, 1);
    expect(moved.y - before.y).toBeCloseTo(-90, 1);
    expect(moved.text).toBe(RETRO_TEXT);

    // Recolour it (it is selected by the drag).
    await page.getByRole("button", { name: "Pink colour" }).click();
    expect(await notes.noteColor(page, first)).toBe("pink");

    // Delete another idea with the keyboard.
    await notes.selectNote(page, second);
    await page.keyboard.press("Delete");

    const remaining = await notes.modelNotes(page);
    expect(remaining.map((note) => note.id).sort()).toEqual([first, third].sort());
    expect(remaining.find((note) => note.id === first)!.text).toBe(RETRO_TEXT);
    expect(remaining.find((note) => note.id === third)!.text).toBe("Blockers");
  });
});

test.describe("creating a note far from the origin (TC-34)", () => {
  test("panned a million board units away, the Sticky note button puts the note at the screen centre", async ({
    page,
  }) => {
    const far = { x: 1_000_000, y: -20_000_000, zoom: 1 };
    await board.setCamera(page, far);

    const id = await notes.createNoteByButton(page);
    const box = await notes.noteBox(page, id);
    const centre = await board.boardCentre(page);

    expect(within(box.x + box.width / 2, centre.x)).toBe(true);
    expect(within(box.y + box.height / 2, centre.y)).toBe(true);

    // It is centred on the world point that the screen centre maps to, so the
    // button works no matter how far the board has been panned.
    const [note] = await notes.modelNotes(page);
    expect(note!.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(far.x + centre.x / far.zoom, 1);
    expect(note!.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(far.y + centre.y / far.zoom, 1);

    // And it is on screen, not a million units away.
    await expect(notes.noteLocator(page, id)).toBeVisible();
  });
});

test.describe("sticky notes without a pointer (extra)", () => {
  test("Tab reaches a note, Enter edits it, Escape keeps the text, Delete removes it", async ({
    page,
  }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 400, y: 300 });
    await page.keyboard.type("Ideas");
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);
    await notes.expectSelected(page, id, false);

    // Start from the board itself: the note is the next thing Tab reaches.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>("[data-testid='board-viewport']")?.focus();
    });
    await page.keyboard.press("Tab");

    const focusedId = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.dataset.noteId ?? null;
    });
    expect(focusedId).toBe(id);
    // Reaching a note with the keyboard selects it.
    await notes.expectSelected(page, id, true);
    await notes.expectEditing(page, id, false);

    await page.keyboard.press("Enter");
    await notes.expectEditing(page, id, true);
    await page.keyboard.type(" and actions");
    await page.keyboard.press("Escape");

    expect(await notes.noteText(page, id)).toBe("Ideas and actions");
    await notes.expectEditing(page, id, false);

    await page.keyboard.press("Delete");
    expect(await notes.noteCount(page)).toBe(0);
  });
});

test.describe("recolouring a note (TC-27)", () => {
  test("Pink changes only the colour: position, stacking, text and selection are untouched", async ({
    page,
  }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await page.keyboard.type("keep me");
    await notes.closeEditor(page, "escape");

    const before = (await notes.modelNotes(page))[0]!;
    const boxBefore = await notes.noteBox(page, id);

    await page.getByRole("button", { name: "Pink colour" }).click();

    const after = (await notes.modelNotes(page))[0]!;
    expect(after.color).toBe("pink");
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);

    const boxAfter = await notes.noteBox(page, id);
    expect(within(boxAfter.x, boxBefore.x)).toBe(true);
    expect(within(boxAfter.y, boxBefore.y)).toBe(true);
    expect(boxAfter.colour).toBe(cssRgb(STICKY_COLORS.pink));

    // Selection unchanged: the toolbar is still open.
    await expect(page.getByTestId("note-toolbar")).toBeVisible();
    await notes.expectSelected(page, id, true);
  });

  test("all six swatches are named and repaint the note", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");

    for (const [name, hex] of Object.entries(STICKY_COLORS)) {
      const label = `${name[0]!.toUpperCase()}${name.slice(1)} colour`;
      await page.getByRole("button", { name: label }).click();
      expect(await notes.noteColor(page, id)).toBe(name);
      expect((await notes.noteBox(page, id)).colour).toBe(cssRgb(hex));
    }
  });
});

test.describe("deleting a note (TC-25, TC-29)", () => {
  test("Delete removes the selected note and nothing else", async ({ page }) => {
    const doomed = await notes.createNoteByDoubleClick(page, { x: 500, y: 300 });
    await notes.closeEditor(page, "outside");
    const kept = await notes.createNoteByDoubleClick(page, { x: 900, y: 500 });
    await notes.closeEditor(page, "outside");
    const keptBefore = (await notes.modelNotes(page)).find((note) => note.id === kept)!;

    await notes.selectNote(page, doomed);
    await page.keyboard.press("Delete");

    expect(await notes.noteCount(page)).toBe(1);
    const remaining = await notes.modelNotes(page);
    expect(remaining.map((note) => note.id)).toEqual([kept]);
    expect(remaining[0]).toMatchObject({ x: keptBefore.x, y: keptBefore.y });
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);
  });

  test("Backspace behaves the same as Delete", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);
    await notes.selectNote(page, id);

    await page.keyboard.press("Backspace");

    expect(await notes.noteCount(page)).toBe(0);
    expect(await notes.modelNotes(page)).toHaveLength(0);
  });

  test("Backspace while editing edits the text instead of deleting the note (TC-26)", async ({
    page,
  }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await page.keyboard.type("ab");
    await page.keyboard.press("Backspace");

    expect(await notes.noteCount(page)).toBe(1);
    expect(await notes.noteText(page, id)).toBe("a");

    await notes.closeEditor(page, "escape");
    expect(await notes.noteCount(page)).toBe(1);
  });

  test("the bin button deletes the selected note", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await notes.closeEditor(page, "escape");
    await notes.clickEmptyBoard(page);
    await notes.selectNote(page, id);

    await page.getByRole("button", { name: "Delete note" }).click();

    expect(await notes.noteCount(page)).toBe(0);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);
  });
});

test.describe("text fitting, the limit and the counter (TC-33)", () => {
  test("a short note renders at the maximum font size", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await page.keyboard.type("Faster onboarding");
    await notes.closeEditor(page, "escape");

    const fontSize = await page
      .locator(`[data-testid="sticky-note"][data-note-id="${id}"] .sticky-text-display`)
      .evaluate((el) => window.getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize)).toBeCloseTo(STICKY_FONT_MAX_PX, 1);
    await expect(page.locator(`[data-note-id="${id}"] .note-fade`)).toHaveCount(0);
  });

  test("1,000 characters: the font shrinks but not below the minimum, the overflow is faded, and nothing leaves the note", async ({
    page,
  }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await page.keyboard.insertText(PROSE_1200);

    // Characters beyond the limit were refused, in the editor and in the model.
    const value = await page.getByTestId("sticky-textarea").inputValue();
    expect(value).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect((await notes.noteText(page, id)).length).toBe(STICKY_TEXT_MAX_CHARS);

    const fontSize = await page.getByTestId("sticky-textarea").evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize),
    );
    expect(fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fontSize).toBeLessThan(STICKY_FONT_MAX_PX);

    await expect(page.locator(`[data-note-id="${id}"]`)).toHaveAttribute("data-overflow", "true");
    await expect(page.locator(`[data-note-id="${id}"] .note-fade`)).toBeVisible();
    await expect(page.getByTestId("sticky-counter")).toHaveText("1000/1000");

    // Nothing is drawn outside the note: the text element is inside its box.
    const noteBox = await notes.noteBox(page, id);
    const textBox = await page.getByTestId("sticky-textarea").boundingBox();
    if (!textBox) throw new Error("the text element has no bounding box");
    expect(textBox.x).toBeGreaterThanOrEqual(noteBox.x - 1);
    expect(textBox.y).toBeGreaterThanOrEqual(noteBox.y - 1);
    expect(textBox.x + textBox.width).toBeLessThanOrEqual(noteBox.x + noteBox.width + 1);
    expect(textBox.y + textBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 1);

    // Still true after closing the editor.
    await notes.closeEditor(page, "escape");
    const displayBox = await page
      .locator(`[data-note-id="${id}"] .sticky-text-display`)
      .boundingBox();
    if (!displayBox) throw new Error("display text has no bounding box");
    expect(displayBox.x).toBeGreaterThanOrEqual(noteBox.x - 1);
    expect(displayBox.y + displayBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 1);
  });

  test("the counter appears only for the last 50 characters", async ({ page }) => {
    const id = await notes.createNoteByDoubleClick(page, { x: 620, y: 300 });
    await page.keyboard.insertText("a".repeat(STICKY_TEXT_MAX_CHARS - 51));
    await expect(page.getByTestId("sticky-counter")).toHaveCount(0);

    await page.keyboard.insertText("a");
    await expect(page.getByTestId("sticky-counter")).toHaveText("950/1000");
    expect((await notes.noteText(page, id)).length).toBe(STICKY_TEXT_MAX_CHARS - 50);
  });
});

function cssRgb(hex: string): string {
  const value = hex.replace("#", "");
  const parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((pair) =>
    Number.parseInt(pair, 16),
  );
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}
