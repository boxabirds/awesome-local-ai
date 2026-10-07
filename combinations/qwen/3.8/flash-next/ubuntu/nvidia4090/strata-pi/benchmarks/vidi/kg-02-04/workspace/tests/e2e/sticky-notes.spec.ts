import { expect, test, type Page } from "@playwright/test";
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import { NAVIGATION_HINT_TEXT } from "../../src/client/canvas/NavigationHint";
import * as board from "./helpers/board";
import { MULTILINE_RETRO_TEXT, PASTE_1200, PROSE_1000, SHORT_NOTE_TEXT, TYPED_GREETING } from "../fixtures/texts";

const PIXEL_TOLERANCE = 1;
const ZOOM_HALF = 0.5;
const ZOOM_DOUBLE = 2;

function within(value: number, target: number, tolerance = PIXEL_TOLERANCE) {
  return Math.abs(value - target) <= tolerance;
}

/** Ends editing without losing the note's selection. */
async function finishEditing(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sticky-text-editor")).toHaveCount(0);
}

/** Double-clicks empty board and returns the id of the note that was created. */
async function createNoteAt(page: Page, x: number, y: number): Promise<string> {
  const before = await board.boardNotes(page);
  await page.mouse.dblclick(x, y);
  await expect(page.getByTestId("sticky-text-editor")).toBeVisible();
  await expect.poll(async () => (await board.boardNotes(page)).length).toBe(before.length + 1);
  return editingNoteId(page);
}

/** The id of the note that is currently being edited. */
async function editingNoteId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const editor = document.querySelector("[data-testid='sticky-text-editor']");
    const note = editor?.closest("[data-testid='sticky-note']");
    return note?.getAttribute("data-note-id") ?? null;
  });
  if (!id) throw new Error("no note is being edited");
  return id;
}

test.describe("workflow 2: capture ideas on sticky notes", () => {
  test("TC-30: double-click creates a note centred on the point and typing goes into it", async ({
    page,
  }) => {
    await board.openBoard(page);
    const point = { x: 400, y: 300 };

    const before = await board.boardNotes(page);
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByTestId("sticky-text-editor")).toBeVisible();
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(before.length + 1);

    const id = await board.noteIdAt(page, 0);
    const box = await board.noteBox(page, id);
    const camera = await board.renderedCamera(page);

    // The note is centred on the double-clicked point, at its natural size.
    expect(within(box.x + box.width / 2, point.x)).toBe(true);
    expect(within(box.y + box.height / 2, point.y)).toBe(true);
    expect(within(box.width, STICKY_SIZE_WORLD * camera.zoom)).toBe(true);
    expect(within(box.height, STICKY_SIZE_WORLD * camera.zoom)).toBe(true);

    // It is being edited straight away, so typing needs no second click.
    await page.keyboard.type(TYPED_GREETING);
    await board.waitForNoteText(page, id, TYPED_GREETING);

    const note = (await board.boardNotes(page)).find((item) => item.id === id)!;
    expect(note.color).toBe("yellow");
    expect(note.z).toBe(1);
  });

  test("TC-31: at 50% zoom a dragged note keeps the grabbed point under the pointer", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.setCamera(page, { x: -120, y: 60, zoom: ZOOM_HALF });

    const id = await createNoteAt(page, 500, 400);
    await finishEditing(page);

    const boxBefore = await board.noteBox(page, id);
    const notesBefore = await board.boardNotes(page);
    const noteBefore = notesBefore.find((note) => note.id === id)!;

    // Grab the note away from its centre so a rotation-shaped error would show.
    const grab = { x: boxBefore.x + boxBefore.width / 2 + 15, y: boxBefore.y + boxBefore.height / 2 - 20 };
    const drag = { dx: 100, dy: 50 };
    await board.dragNote(page, grab, drag.dx, drag.dy);

    const boxAfter = await board.noteBox(page, id);
    // The grabbed point stayed under the pointer.
    expect(within(boxAfter.x - boxBefore.x, drag.dx)).toBe(true);
    expect(within(boxAfter.y - boxBefore.y, drag.dy)).toBe(true);

    // 100 x 50 screen pixels at 50% zoom is 200 x 100 board units.
    const noteAfter = (await board.boardNotes(page)).find((note) => note.id === id)!;
    expect(noteAfter.x).toBeCloseTo(noteBefore.x + drag.dx / ZOOM_HALF, 1);
    expect(noteAfter.y).toBeCloseTo(noteBefore.y + drag.dy / ZOOM_HALF, 1);
  });

  test("TC-32: at 200% zoom a dragged note moves half the screen distance and is drawn on top", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.setCamera(page, { x: 0, y: 0, zoom: ZOOM_DOUBLE });

    const first = await createNoteAt(page, 300, 300);
    await finishEditing(page);
    const second = await createNoteAt(page, 1000, 600);
    await finishEditing(page);

    const notesBefore = await board.boardNotes(page);
    const firstBefore = notesBefore.find((note) => note.id === first)!;
    const secondBefore = notesBefore.find((note) => note.id === second)!;
    expect(firstBefore.z).toBeLessThan(secondBefore.z);

    const grab = await board.noteCentre(page, first);
    const drag = { dx: 500, dy: 200 };
    await board.dragNote(page, grab, drag.dx, drag.dy);

    const noteAfter = (await board.boardNotes(page)).find((note) => note.id === first)!;
    // 500 x 200 screen pixels at 200% zoom is 250 x 100 board units.
    expect(noteAfter.x).toBeCloseTo(firstBefore.x + drag.dx / ZOOM_DOUBLE, 1);
    expect(noteAfter.y).toBeCloseTo(firstBefore.y + drag.dy / ZOOM_DOUBLE, 1);

    // It now overlaps the other note and is painted above it.
    const boxFirst = await board.noteBox(page, first);
    const boxSecond = await board.noteBox(page, second);
    const overlaps =
      boxFirst.x < boxSecond.x + boxSecond.width &&
      boxSecond.x < boxFirst.x + boxFirst.width &&
      boxFirst.y < boxSecond.y + boxSecond.height &&
      boxSecond.y < boxFirst.y + boxFirst.height;
    expect(overlaps).toBe(true);

    const order = await board.notePaintOrder(page);
    expect(order.indexOf(first)).toBeGreaterThan(order.indexOf(second));
    const notes = await board.boardNotes(page);
    expect(notes.find((note) => note.id === first)!.z).toBeGreaterThan(
      notes.find((note) => note.id === second)!.z,
    );
  });

  test("TC-33: text auto-fits, then clips inside the note with a fade at the limit", async ({
    page,
  }) => {
    await board.openBoard(page);
    const id = await createNoteAt(page, 640, 400);

    const editor = page.getByTestId("sticky-text-editor");
    // A short note uses the largest readable size.
    await page.keyboard.type("Hello");
    await board.waitForNoteText(page, id, "Hello");
    await expect
      .poll(async () => Number(await editor.evaluate((el) => getComputedStyle(el).fontSize.replace("px", ""))))
      .toBeCloseTo(STICKY_FONT_MAX_PX, 0);

    // A paste longer than the limit keeps exactly the first 1,000 characters.
    await editor.fill(PASTE_1200);
    await board.waitForNoteText(page, id, PROSE_1000);
    expect(await editor.inputValue()).toHaveLength(STICKY_TEXT_MAX_CHARS);

    await expect(page.getByTestId("sticky-counter")).toHaveText(`1000/${STICKY_TEXT_MAX_CHARS}`);

    const measurements = await editor.evaluate((el) => ({
      fontPx: Number(getComputedStyle(el).fontSize.replace("px", "")),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      rect: el.getBoundingClientRect().toJSON(),
    }));
    expect(measurements.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(measurements.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    // Clipped: more text than the box shows.
    expect(measurements.scrollHeight).toBeGreaterThan(measurements.clientHeight);

    // Nothing is drawn outside the note.
    const box = await board.noteBox(page, id);
    expect(measurements.rect.left).toBeGreaterThanOrEqual(box.x - PIXEL_TOLERANCE);
    expect(measurements.rect.top).toBeGreaterThanOrEqual(box.y - PIXEL_TOLERANCE);
    expect(measurements.rect.right).toBeLessThanOrEqual(box.x + box.width + PIXEL_TOLERANCE);
    expect(measurements.rect.bottom).toBeLessThanOrEqual(box.y + box.height + PIXEL_TOLERANCE);

    const fade = page.getByTestId("sticky-overflow-fade");
    await expect(fade).toBeVisible();
    const fadeBox = await fade.boundingBox();
    expect(fadeBox).not.toBeNull();
    expect(fadeBox!.x).toBeGreaterThanOrEqual(box.x - PIXEL_TOLERANCE);
    expect(fadeBox!.y + fadeBox!.height).toBeLessThanOrEqual(box.y + box.height + PIXEL_TOLERANCE);

    // The note itself never grows.
    expect(within(box.width, STICKY_SIZE_WORLD)).toBe(true);
    expect(within(box.height, STICKY_SIZE_WORLD)).toBe(true);
  });

  test("TC-34: the Sticky note button creates a note in view even when the board is panned far away", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.setCamera(page, { x: -250_000, y: 180_000, zoom: 1 });

    await page.getByTestId("sticky-note-button").click();
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(1);

    const id = await board.noteIdAt(page, 0);
    const centre = await board.noteCentre(page, id);
    const view = await board.boardCentre(page);
    expect(within(centre.x, view.x)).toBe(true);
    expect(within(centre.y, view.y)).toBe(true);

    // And it is ready for typing.
    await page.keyboard.type(SHORT_NOTE_TEXT);
    await board.waitForNoteText(page, id, SHORT_NOTE_TEXT);
  });

  test("golden path: capture, rearrange, recolour and delete notes", async ({ page }) => {
    await board.openBoard(page);

    // The empty board still shows story 1's hint.
    await expect(page.getByTestId("navigation-hint")).toHaveText(NAVIGATION_HINT_TEXT);

    // Capture two ideas.
    const first = await createNoteAt(page, 350, 300);
    await page.keyboard.type(SHORT_NOTE_TEXT);
    await board.waitForNoteText(page, first, SHORT_NOTE_TEXT);
    await finishEditing(page);

    const second = await createNoteAt(page, 700, 520);
    await page.keyboard.type(MULTILINE_RETRO_TEXT);
    await board.waitForNoteText(page, second, MULTILINE_RETRO_TEXT);
    await finishEditing(page);

    // A click on a note selects it; a click on empty board clears that.
    const firstCentre = await board.noteCentre(page, first);
    await page.mouse.click(firstCentre.x, firstCentre.y);
    expect(await board.selectedNoteIds(page)).toEqual([first]);
    await expect(page.getByTestId("note-toolbar")).toBeVisible();

    await page.mouse.click(60, 700);
    expect(await board.selectedNoteIds(page)).toEqual([]);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);

    // Rearrange: put the first idea next to its neighbour.
    const before = (await board.boardNotes(page)).find((note) => note.id === first)!;
    const grab = await board.noteCentre(page, first);
    await board.dragNote(page, grab, 220, 120);
    const after = (await board.boardNotes(page)).find((note) => note.id === first)!;
    expect(after.x).toBeCloseTo(before.x + 220, 1);
    expect(after.y).toBeCloseTo(before.y + 120, 1);
    expect(after.text).toBe(SHORT_NOTE_TEXT);

    // Recolour a theme.
    await page.getByRole("button", { name: "Pink colour" }).click();
    await expect
      .poll(async () => (await board.boardNotes(page)).find((note) => note.id === first)!.color)
      .toBe("pink");
    const recoloured = (await board.boardNotes(page)).find((note) => note.id === first)!;
    expect(recoloured.x).toBe(after.x);
    expect(recoloured.text).toBe(SHORT_NOTE_TEXT);
    expect(recoloured.z).toBe(after.z);

    // Deleting with the keyboard while the note is only selected.
    const secondCentre = await board.noteCentre(page, second);
    await page.mouse.click(secondCentre.x, secondCentre.y);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(1);
    expect(await board.selectedNoteIds(page)).toEqual([]);

    // Deleting with the toolbar bin.
    const remaining = await board.noteIdAt(page, 0);
    const remainingCentre = await board.noteCentre(page, remaining);
    await page.mouse.click(remainingCentre.x, remainingCentre.y);
    await page.getByTestId("note-delete").click();
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(0);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);
  });

  test("notes keep their board position while the board is panned and zoomed", async ({ page }) => {
    await board.openBoard(page);
    const id = await createNoteAt(page, 500, 400);
    await finishEditing(page);

    const notesBefore = await board.boardNotes(page);
    const before = notesBefore.find((note) => note.id === id)!;

    // Pan the empty board: the note moves with it, its board position does not change.
    const boxBefore = await board.noteBox(page, id);
    await board.dragBoard(page, { x: 60, y: 700 }, 200, 100);
    const boxAfterPan = await board.noteBox(page, id);
    expect(within(boxAfterPan.x - boxBefore.x, 200)).toBe(true);
    expect(within(boxAfterPan.y - boxBefore.y, 100)).toBe(true);

    // Zoom: the note scales with the board.
    await board.setCamera(page, { x: -100, y: -50, zoom: ZOOM_HALF });
    const boxZoomed = await board.noteBox(page, id);
    expect(within(boxZoomed.width, STICKY_SIZE_WORLD * ZOOM_HALF)).toBe(true);
    expect(within(boxZoomed.height, STICKY_SIZE_WORLD * ZOOM_HALF)).toBe(true);

    const notesAfter = await board.boardNotes(page);
    const after = notesAfter.find((note) => note.id === id)!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  test("a double-click on a note edits it instead of creating a new one", async ({ page }) => {
    await board.openBoard(page);
    const id = await createNoteAt(page, 400, 300);
    await finishEditing(page);

    const centre = await board.noteCentre(page, id);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect(page.getByTestId("sticky-text-editor")).toBeVisible();
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(1);

    await page.keyboard.type(" added");
    await board.waitForNoteText(page, id, " added");
  });

  test("editing a note keeps keyboard deletions on the text, not the note", async ({ page }) => {
    await board.openBoard(page);
    const id = await createNoteAt(page, 400, 300);
    await page.keyboard.type("ab");
    await board.waitForNoteText(page, id, "ab");

    await page.keyboard.press("Backspace");
    await board.waitForNoteText(page, id, "a");
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(1);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await board.boardNotes(page)).length).toBe(0);
  });
});
