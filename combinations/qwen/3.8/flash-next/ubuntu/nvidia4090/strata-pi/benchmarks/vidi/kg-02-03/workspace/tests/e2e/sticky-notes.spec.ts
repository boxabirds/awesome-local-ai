import { expect, test } from "@playwright/test";
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../src/shared/config";
import { LONG_NOTE_TEXT_1000, SHORT_NOTE_TEXT } from "../fixtures/texts";
import * as board from "./helpers/board";
import {
  createNoteByDoubleClick,
  dragNote,
  endEditing,
  noteByIndex,
  noteCentreOf,
  noteCount,
  notes,
  rgbOf,
  topNote,
  typeIntoEditor,
  waitForNotes,
} from "./helpers/sticky";

/**
 * e2e tests for story 2 (TC-30 to TC-34): the brainstorm golden path, drag
 * geometry at 50% and 200% zoom, text fit with a 1,000 character note, and
 * creating a note while panned far away.
 */

const PIXEL_TOLERANCE = 1;

function deltaIs(actual: number, expected: number, tolerance = PIXEL_TOLERANCE): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

test.describe("sticky notes", () => {
  test("TC-30 then TC-31: double-click to create, type, move at 50% zoom, recolour, delete", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.waitForRenderedBoard(page);

    // TC-30: a real double-click on empty board space creates a note centred
    // on the point that was clicked, and typing goes straight into it.
    const clicked = { x: 400, y: 300 };
    await createNoteByDoubleClick(page, clicked);
    await typeIntoEditor(page, SHORT_NOTE_TEXT);
    await endEditing(page);

    await waitForNotes(page, 1);
    const created = await noteByIndex(page, 0);
    expect(deltaIs(created.centre.x, clicked.x)).toBe(true);
    expect(deltaIs(created.centre.y, clicked.y)).toBe(true);
    expect(created.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(created.height).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(created.text).toBe(SHORT_NOTE_TEXT);
    expect(created.background).toBe(rgbOf(STICKY_COLORS.yellow));

    // The empty-board hint makes way as soon as a note exists.
    await expect(page.getByTestId("navigation-hint")).toHaveCount(0);

    // TC-31: at 50% zoom a real drag of (100, 50) screen pixels moves the note
    // by exactly that on screen, and by (200, 100) in world coordinates.
    await board.setCamera(page, { x: -640, y: -400, zoom: 0.5 });
    const beforeDrag = await noteByIndex(page, 0);
    expect(beforeDrag.width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 1);

    await dragNote(page, beforeDrag.centre, 100, 50);

    const cam = await board.readCamera(page);
    const afterDrag = await noteByIndex(page, 0);
    // The grabbed point stays under the pointer.
    expect(deltaIs(afterDrag.centre.x - beforeDrag.centre.x, 100)).toBe(true);
    expect(deltaIs(afterDrag.centre.y - beforeDrag.centre.y, 50)).toBe(true);
    // World movement is the screen delta divided by the zoom.
    expect(deltaIs(afterDrag.worldX - beforeDrag.worldX, 100 / cam.zoom)).toBe(true);
    expect(deltaIs(afterDrag.worldY - beforeDrag.worldY, 50 / cam.zoom)).toBe(true);

    // The note stayed selected through the drag, so its toolbar is available.
    expect(afterDrag.selected).toBe(true);
    await page.getByRole("button", { name: "Green colour" }).click();
    await expect
      .poll(async () => (await noteByIndex(page, 0)).background)
      .toBe(rgbOf(STICKY_COLORS.green));

    // Dragging a note must not pan the board.
    const cameraAfterDrag = await board.readCamera(page);
    expect(cameraAfterDrag.x).toBeCloseTo(cam.x, 2);
    expect(cameraAfterDrag.y).toBeCloseTo(cam.y, 2);
    expect(cameraAfterDrag.zoom).toBeCloseTo(cam.zoom, 4);

    // Delete key removes the selected note; the board ends empty.
    await page.keyboard.press("Delete");
    await waitForNotes(page, 0);
    expect(await noteCount(page)).toBe(0);
  });

  test("TC-31/TC-32: drag geometry at 200% zoom and the dragged note comes to the front", async ({
    page,
  }) => {
    await board.openBoard(page);
    // Zoom first, so the notes are created in the zoomed view.
    await board.setCamera(page, { x: -640, y: -400, zoom: 2 });

    const lowerClicked = { x: 500, y: 350 };
    await createNoteByDoubleClick(page, lowerClicked);
    await endEditing(page);

    // Second note on empty space that still overlaps the first one.
    const upperClicked = { x: 760, y: 500 };
    await createNoteByDoubleClick(page, upperClicked);
    await endEditing(page);

    await waitForNotes(page, 2);
    const all = await notes(page);
    const lower = all.find((note) => deltaIs(note.centre.x, lowerClicked.x) && deltaIs(note.centre.y, lowerClicked.y))!;
    const upper = all.find((note) => deltaIs(note.centre.x, upperClicked.x) && deltaIs(note.centre.y, upperClicked.y))!;
    expect(lower.zIndex).toBeLessThan(upper.zIndex);
    expect(lower.width).toBeCloseTo(STICKY_SIZE_WORLD * 2, 1);

    // Grab the lower note somewhere the upper one does not cover.
    const grab = { x: lower.centre.x - 100, y: lower.centre.y - 100 };
    await dragNote(page, grab, 100, 50);

    const cam = await board.readCamera(page);
    const moved = await notes(page);
    const movedLower = moved.find((note) => note.id === lower.id)!;
    const stillUpper = moved.find((note) => note.id === upper.id)!;

    // TC-32: world movement is (50, 25) for a (100, 50) screen drag at 200%.
    expect(deltaIs(movedLower.worldX - lower.worldX, 100 / cam.zoom)).toBe(true);
    expect(deltaIs(movedLower.worldY - lower.worldY, 50 / cam.zoom)).toBe(true);
    expect(deltaIs(movedLower.centre.x - lower.centre.x, 100)).toBe(true);

    // sticky.move stacking: the dragged note is now drawn above the note it overlaps.
    expect(movedLower.zIndex).toBeGreaterThan(stillUpper.zIndex);
    const overlapX =
      Math.min(movedLower.centre.x + movedLower.width / 2, stillUpper.centre.x + stillUpper.width / 2) -
      Math.max(movedLower.centre.x - movedLower.width / 2, stillUpper.centre.x - stillUpper.width / 2);
    const overlapY =
      Math.min(movedLower.centre.y + movedLower.height / 2, stillUpper.centre.y + stillUpper.height / 2) -
      Math.max(movedLower.centre.y - movedLower.height / 2, stillUpper.centre.y - stillUpper.height / 2);
    expect(overlapX).toBeGreaterThan(0);
    expect(overlapY).toBeGreaterThan(0);
  });

  test("TC-33: a short note uses the maximum font size, a 1,000 character note fits and fades", async ({
    page,
  }) => {
    await board.openBoard(page);

    await createNoteByDoubleClick(page, { x: 640, y: 400 });
    await typeIntoEditor(page, "Hello");
    await endEditing(page);

    const short = await noteByIndex(page, 0);
    expect(short.fontPx).toBeCloseTo(STICKY_FONT_MAX_PX, 2);
    expect(short.overflow).toBe(false);

    await createNoteByDoubleClick(page, { x: 640, y: 400 });
    await typeIntoEditor(page, LONG_NOTE_TEXT_1000);
    await endEditing(page);

    const long = await noteByIndex(page, 0);
    expect(long.text.length).toBe(LONG_NOTE_TEXT_1000.length);
    expect(long.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(long.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(long.overflow).toBe(true);

    // Nothing is rendered outside the note box.
    const box = await page.getByTestId("sticky-note").first().boundingBox();
    if (!box) throw new Error("note has no bounding box");
    expect(long.textBox.x).toBeGreaterThanOrEqual(box.x - PIXEL_TOLERANCE);
    expect(long.textBox.y).toBeGreaterThanOrEqual(box.y - PIXEL_TOLERANCE);
    expect(long.textBox.x + long.textBox.width).toBeLessThanOrEqual(box.x + box.width + PIXEL_TOLERANCE);
    expect(long.textBox.y + long.textBox.height).toBeLessThanOrEqual(box.y + box.height + PIXEL_TOLERANCE);

    // The text is clipped: its scrollable height exceeds the box it is drawn in.
    const clipped = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-testid='sticky-note'] [data-testid='sticky-text']");
      if (!el) throw new Error("note text element is missing");
      return el.scrollHeight > el.clientHeight + 1;
    });
    expect(clipped).toBe(true);
  });

  test("TC-34: panned far away, the Sticky note button puts a note at the centre of the screen", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.setCamera(page, { x: 5200, y: 3400, zoom: 1 });

    await page.getByRole("button", { name: "Sticky note" }).click();
    await waitForNotes(page, 1);

    const created = await topNote(page);
    const centre = await noteCentreOf(page);
    expect(deltaIs(created.centre.x, centre.x)).toBe(true);
    expect(deltaIs(created.centre.y, centre.y)).toBe(true);
    await expect(page.getByTestId("sticky-note").first()).toBeInViewport();

    // The new note is ready to type in.
    await typeIntoEditor(page, "Back home");
    await endEditing(page);
    expect((await topNote(page)).text).toBe("Back home");

    // Sanity: the camera limits from story 1 are untouched by story 2.
    expect((await board.readCamera(page)).zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect((await board.readCamera(page)).zoom).toBeLessThanOrEqual(ZOOM_MAX);
  });

  test("double-click on an existing note edits it instead of creating a new one", async ({
    page,
  }) => {
    await board.openBoard(page);
    await createNoteByDoubleClick(page, { x: 500, y: 300 });
    await typeIntoEditor(page, "Keep");
    await endEditing(page);
    await waitForNotes(page, 1);

    const before = await noteByIndex(page, 0);
    await page.mouse.dblclick(before.centre.x, before.centre.y);
    await typeIntoEditor(page, "Kept it");
    await endEditing(page);

    await waitForNotes(page, 1);
    const after = await noteByIndex(page, 0);
    expect(after.id).toBe(before.id);
    expect(after.text).toBe("Kept it");
    expect(deltaIs(after.centre.x, before.centre.x)).toBe(true);
  });
});
