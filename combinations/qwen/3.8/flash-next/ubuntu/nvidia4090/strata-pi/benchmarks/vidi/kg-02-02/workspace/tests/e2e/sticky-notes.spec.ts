import { expect, test, type Page } from "@playwright/test";
import { screenToWorld } from "../../src/client/canvas/camera";
import { PROSE_1000, PROSE_1200, RETRO_NOTE_TEXT, SHORT_NOTE_TEXT, proseOfLength } from "../fixtures/texts";
import {
  boardBox,
  boardCentre,
  clickNote,
  colourSwatch,
  createNoteByButton,
  ctrlWheel,
  deleteNoteButton,
  doubleClickBoard,
  dragBoard,
  dragNote,
  endEditing,
  fillNoteText,
  noteCentre,
  noteCount,
  noteEditor,
  notes,
  openBoard,
  readCamera,
  setCamera,
  settle,
  type NoteView,
  type XY,
} from "./helpers/board";

function first(list: NoteView[]): NoteView {
  const note = list[0];
  if (!note) throw new Error("no sticky note is on the board");
  return note;
}

function only(list: NoteView[], text: string): NoteView {
  const note = list.find((candidate) => candidate.text === text);
  if (!note) throw new Error(`no note with text "${text}"`);
  return note;
}

function onlyById(list: NoteView[], id: string): NoteView {
  const note = list.find((candidate) => candidate.id === id);
  if (!note) throw new Error(`no note with id ${id}`);
  return note;
}

async function screenCentreOf(page: Page, id: string): Promise<XY> {
  return noteCentre(page, id);
}

/** World point under a screen point, using the camera the board has rendered. */
async function worldAt(page: Page, at: XY): Promise<XY> {
  await settle(page);
  return screenToWorld(await readCamera(page), at);
}

/**
 * TC-30 (sticky.interaction / create): a real double-click at (400, 300) on an
 * empty board creates a note centred on that point, straight into editing, and
 * the typed text lands in it.
 */
test("TC-30 double-click on empty board creates a note centred on that point", async ({ page }) => {
  await openBoard(page);

  const at: XY = { x: 400, y: 300 };
  await doubleClickBoard(page, at);
  await fillNoteText(page, "Hello");

  const note = first(await notes(page));
  const world = await worldAt(page, at);
  expect(note.text).toBe("Hello");
  expect(note.width).toBe(200);
  expect(note.height).toBe(200);
  expect(note.x + note.width / 2).toBeCloseTo(world.x, 0);
  expect(note.y + note.height / 2).toBeCloseTo(world.y, 0);
  // ±1px on screen, not just in world units.
  const centre = await screenCentreOf(page, note.id);
  expect(Math.abs(centre.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - at.y)).toBeLessThanOrEqual(1);
  await expect(note.selected).toBe(true);
});

/**
 * TC-31 (sticky.interaction / move at 50%): a real drag of (100, 50) screen
 * pixels moves the note by (200, 100) board units and the grabbed point stays
 * under the pointer.
 */
test("TC-31 dragging at 50% zoom: grabbed point stays under the pointer", async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: -600, y: -400, zoom: 0.5 });

  const at: XY = { x: 500, y: 400 };
  await doubleClickBoard(page, at);
  await fillNoteText(page, SHORT_NOTE_TEXT);
  await endEditing(page);

  const before = first(await notes(page));
  const centreBefore = await screenCentreOf(page, before.id);

  await dragNote(page, before.id, 100, 50);

  const after = onlyById(await notes(page), before.id);
  expect(after.x).toBeCloseTo(before.x + 100 / 0.5, 1);
  expect(after.y).toBeCloseTo(before.y + 50 / 0.5, 1);

  // The note moved on screen by exactly the pointer movement.
  const centreAfter = await screenCentreOf(page, before.id);
  expect(Math.abs(centreAfter.x - (centreBefore.x + 100))).toBeLessThanOrEqual(1);
  expect(Math.abs(centreAfter.y - (centreBefore.y + 50))).toBeLessThanOrEqual(1);

  // The board itself never moved while a note was being dragged.
  expect(await readCamera(page)).toEqual({ x: -600, y: -400, zoom: 0.5 });
});

/**
 * TC-32 (sticky.interaction / move at 200%): the same screen drag is half as
 * many board units, and the note that was dragged ends up drawn above the one
 * it overlaps.
 */
test("TC-32 dragging at 200% zoom moves half as many board units and lands on top", async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, { x: -300, y: -200, zoom: 2 });

  const centre = await boardCentre(page);
  await doubleClickBoard(page, { x: centre.x - 150, y: centre.y });
  await fillNoteText(page, "written first");
  await endEditing(page);

  await doubleClickBoard(page, { x: centre.x + 150, y: centre.y });
  await fillNoteText(page, "dragged on top");
  await endEditing(page);

  const list = await notes(page);
  const dragged = only(list, "dragged on top");
  const other = only(list, "written first");

  await dragNote(page, dragged.id, 100, 50);

  const moved = onlyById(await notes(page), dragged.id);
  expect(moved.x).toBeCloseTo(dragged.x + 100 / 2, 1);
  expect(moved.y).toBeCloseTo(dragged.y + 50 / 2, 1);

  // Paint order and hit testing both put the dragged note on top.
  const ordered = await notes(page);
  expect(ordered.findIndex((note) => note.id === dragged.id)).toBeGreaterThan(
    ordered.findIndex((note) => note.id === other.id),
  );
  const overlap = await screenCentreOf(page, dragged.id);
  const hitId = await page.evaluate((point) => {
    const el = document.elementFromPoint(point.x, point.y);
    return el?.closest("[data-note-id]")?.getAttribute("data-note-id") ?? null;
  }, overlap);
  expect(hitId).toBe(dragged.id);
});

/**
 * TC-33 (sticky.text / font fit): one word is drawn at the maximum font size;
 * pasting 1,000 characters shrinks the font (never below the minimum), clips
 * the text inside the unchanged note box and shows the bottom fade.
 */
test("TC-33 one word uses the maximum font, 1,000 pasted characters shrink and clip", async ({
  page,
}) => {
  await openBoard(page);
  const centre = await boardCentre(page);

  await doubleClickBoard(page, { x: centre.x - 220, y: centre.y });
  await fillNoteText(page, SHORT_NOTE_TEXT);
  await endEditing(page);

  await doubleClickBoard(page, { x: centre.x + 220, y: centre.y });
  const box = noteEditor(page);
  await expect(box).toBeVisible();
  await box.click();
  await page.keyboard.insertText(PROSE_1200);
  await settle(page);
  await endEditing(page);

  const list = await notes(page);
  const shortNote = only(list, SHORT_NOTE_TEXT);
  const longNote = only(list, PROSE_1000);

  expect(shortNote.fontPx).toBe(24);
  expect(longNote.fontPx).toBeGreaterThanOrEqual(10);
  expect(longNote.fontPx).toBeLessThan(shortNote.fontPx);

  // The note box is unchanged; only the text size adapted.
  expect(longNote.width).toBe(200);
  expect(longNote.height).toBe(200);

  // All 1,000 characters are in the note, the overflow is clipped and faded.
  expect(longNote.text.length).toBe(1000);
  expect(longNote.counter).toBe("1000/1000");
  const clipped = await page
    .locator(`[data-note-id='${longNote.id}'] .sticky-text`)
    .evaluate((el) => (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight);
  expect(clipped).toBeGreaterThan(0);
  expect(longNote.overflow).toBe(true);
  expect(shortNote.overflow).toBe(false);
  await expect(page.locator(`[data-note-id='${longNote.id}'] [data-testid='sticky-overflow']`)).toBeVisible();

  // Nothing is painted outside the note box: the text element is clipped to it.
  const outside = await page
    .locator(`[data-note-id='${longNote.id}']`)
    .evaluate((el) => {
      const note = (el as HTMLElement).getBoundingClientRect();
      const text = el.querySelector<HTMLElement>(".sticky-text")?.getBoundingClientRect();
      if (!text) return Number.MAX_SAFE_INTEGER;
      return Math.max(
        note.left - text.left,
        note.top - text.top,
        text.right - note.right,
        text.bottom - note.bottom,
      );
    });
  expect(outside).toBeLessThanOrEqual(1);
});

/**
 * TC-34 (sticky.toolbar / create while panned far away): the sticky note button
 * is part of the visible UI and puts the new note in the middle of what is on
 * screen, no matter how far the board has been panned.
 */
test("TC-34 the sticky note button centres a note in the visible board far from the origin", async ({
  page,
}) => {
  await openBoard(page);
  await dragBoard(page, { x: 640, y: 400 }, 400, 300, 8);
  await ctrlWheel(page, await boardCentre(page), -240);
  const camera = await readCamera(page);

  await createNoteByButton(page);

  const note = first(await notes(page));
  const centre = await boardCentre(page);
  const onScreen = await screenCentreOf(page, note.id);
  expect(Math.abs(onScreen.x - centre.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(onScreen.y - centre.y)).toBeLessThanOrEqual(2);

  const world = await worldAt(page, centre);
  expect(note.x + note.width / 2).toBeCloseTo(world.x, 1);
  expect(note.y + note.height / 2).toBeCloseTo(world.y, 1);

  // It went straight into editing, so typing lands in the new note.
  await fillNoteText(page, "created far from the origin");
  await endEditing(page);
  expect(first(await notes(page)).text).toBe("created far from the origin");
  expect((await readCamera(page)).zoom).toBeCloseTo(camera.zoom, 6);
});

/**
 * Text limits in the browser (the boundary values of TC-14 to TC-17): typing
 * and pasting are both cut at 1,000 characters, and the counter only appears
 * for the last 50.
 */
test("text boundaries: typed and pasted text is capped at 1,000 characters", async ({ page }) => {
  await openBoard(page);

  await createNoteByButton(page);
  await fillNoteText(page, PROSE_1200);
  await endEditing(page);
  const pasted = first(await notes(page));
  expect(pasted.text).toBe(PROSE_1000);
  expect(pasted.counter).toBe("1000/1000");

  await clickNote(page, pasted.id);
  await page.keyboard.press("Enter");
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await settle(page);
  await endEditing(page);
  const stillFull = first(await notes(page));
  expect(stillFull.text).toBe(PROSE_1000);
  expect(stillFull.counter).toBe("1000/1000");

  await clickNote(page, pasted.id);
  await page.keyboard.press("Enter");
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.type("x".repeat(60));
  await settle(page);
  await endEditing(page);
  const typed = first(await notes(page));
  expect(typed.text.length).toBe(1000);

  await clickNote(page, pasted.id);
  await page.keyboard.press("Enter");
  await settle(page);
  await fillNoteText(page, proseOfLength(949));
  await endEditing(page);
  expect(first(await notes(page)).counter).toBeNull();

  await clickNote(page, pasted.id);
  await page.keyboard.press("Enter");
  await settle(page);
  await fillNoteText(page, proseOfLength(950));
  await endEditing(page);
  expect(first(await notes(page)).counter).toBe("950/1000");
});

/**
 * Workflow 1 "Brainstorm golden path" (TC-30 -> TC-31 -> colour -> delete):
 * create by double-click, type, move at 50% zoom, recolour, delete. The board
 * is asserted at every step and ends with the remaining notes untouched.
 */
test("workflow 1: brainstorm golden path", async ({ page }) => {
  await openBoard(page);
  const centre = await boardCentre(page);

  // Two notes, one of them multi-line.
  await doubleClickBoard(page, { x: centre.x - 240, y: centre.y - 60 });
  await fillNoteText(page, RETRO_NOTE_TEXT);
  await endEditing(page);

  await createNoteByButton(page);
  await fillNoteText(page, SHORT_NOTE_TEXT);
  await endEditing(page);
  expect(await noteCount(page)).toBe(2);

  // Move the short note at 50% zoom.
  await setCamera(page, { x: -600, y: -400, zoom: 0.5 });
  let list = await notes(page);
  const moving = only(list, SHORT_NOTE_TEXT);
  const kept = only(list, RETRO_NOTE_TEXT);
  await dragNote(page, moving.id, 60, -40);

  list = await notes(page);
  const moved = onlyById(list, moving.id);
  expect(moved.x).toBeCloseTo(moving.x + 60 / 0.5, 1);
  expect(moved.y).toBeCloseTo(moving.y - 40 / 0.5, 1);
  expect(onlyById(list, kept.id)).toEqual(kept);

  // Recolour it: only the colour changes.
  await clickNote(page, moving.id);
  await colourSwatch(page, "Blue").click();
  await settle(page);

  list = await notes(page);
  const recoloured = onlyById(list, moving.id);
  expect(recoloured.background).toBe("rgb(144, 202, 249)"); // STICKY_COLORS.blue
  expect(recoloured.x).toBeCloseTo(moved.x, 6);
  expect(recoloured.y).toBeCloseTo(moved.y, 6);
  expect(recoloured.text).toBe(SHORT_NOTE_TEXT);
  expect(onlyById(list, kept.id).background).toBe("rgb(255, 245, 157)"); // default yellow

  // Delete it with the keyboard.
  await page.keyboard.press("Delete");
  await settle(page);
  const remaining = await notes(page);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.id).toBe(kept.id);
  await expect(page.getByRole("toolbar", { name: "Note tools" })).toHaveCount(0);

  // The board camera is where it was: creating, moving, recolouring and
  // deleting notes never moves the view.
  expect(await readCamera(page)).toEqual({ x: -600, y: -400, zoom: 0.5 });
});

/**
 * TC-34 in the design's negative list of persistence: nothing in story 2 keeps
 * the document after the tab closes. Story 3 replaces this with the reload half
 * of its own TC-34 once the board document lives in the Durable Object.
 */
test.skip("notes survive a reload of the board (needs story 3's stored document)", async ({ page }) => {
  await openBoard(page);
  const centre = await boardCentre(page);

  await doubleClickBoard(page, { x: centre.x - 200, y: centre.y });
  await fillNoteText(page, "kept across reload");
  await endEditing(page);

  const before = only(await notes(page), "kept across reload");
  await dragNote(page, before.id, 70, 40);

  await page.reload({ waitUntil: "load" });
  await settle(page);

  const after = only(await notes(page), "kept across reload");
  expect(after.x).toBeCloseTo(before.x + 70, 1);
  expect(after.y).toBeCloseTo(before.y + 40, 1);
});

/** Story 1's guarantees still hold with notes on the board. */
test("story 1 regression: pan, zoom and click still work with notes on the board", async ({
  page,
}) => {
  await openBoard(page);
  await createNoteByButton(page);
  await endEditing(page);

  const cameraBefore = await readCamera(page);
  const centre = await boardCentre(page);

  // A drag on empty board space pans.
  await dragBoard(page, { x: centre.x - 320, y: centre.y - 320 }, 120, 60);
  const cameraAfter = await readCamera(page);
  expect(cameraAfter.x).toBeCloseTo(cameraBefore.x - 120 / cameraBefore.zoom, 6);
  expect(cameraAfter.y).toBeCloseTo(cameraBefore.y - 60 / cameraBefore.zoom, 6);

  // Ctrl/Cmd + wheel zooms; plain wheel over the board pans (story 1 semantics).
  await ctrlWheel(page, { x: centre.x + 300, y: centre.y + 300 }, -240);
  const cameraZoomed = await readCamera(page);
  expect(cameraZoomed.zoom).toBeGreaterThan(cameraAfter.zoom);
  await page.mouse.move(centre.x - 200, centre.y - 200);
  await page.mouse.wheel(0, -120);
  await settle(page);
  const cameraPanned = await readCamera(page);
  expect(cameraPanned.zoom).toBeCloseTo(cameraZoomed.zoom, 6);
  expect(cameraPanned.y).not.toBeCloseTo(cameraZoomed.y, 6);

  // Clicking a note selects it, clicking empty space clears it, and neither
  // moves the board.
  const note = first(await notes(page));
  await clickNote(page, note.id);
  expect(first(await notes(page)).selected).toBe(true);

  await page.mouse.click(centre.x - 300, centre.y + 250);
  await settle(page);
  expect(first(await notes(page)).selected).toBe(false);
  expect(await noteCount(page)).toBe(1);
  expect(await readCamera(page)).toEqual(cameraPanned);
});

/** The note toolbar is reachable from the keyboard and never blocks the board. */
test("note tools are keyboard reachable and the board still pans after a drag", async ({ page }) => {
  await openBoard(page);
  const centre = await boardCentre(page);

  await doubleClickBoard(page, { x: centre.x - 240, y: centre.y });
  await fillNoteText(page, "keyboard one");
  await endEditing(page);

  await doubleClickBoard(page, { x: centre.x + 240, y: centre.y });
  await fillNoteText(page, "keyboard two");
  await endEditing(page);
  expect(await noteCount(page)).toBe(2);

  // Keyboard route to the tools: focus the note, Enter to edit, Escape back to
  // Selected, Tab to its toolbar, Delete to remove it.
  const note = only(await notes(page), "keyboard one");
  await page.locator(`[data-note-id='${note.id}']`).focus();
  await page.keyboard.press("Enter");
  await settle(page);
  await expect(noteEditor(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await settle(page);

  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? (el.getAttribute("aria-label") ?? el.tagName) : null;
  });
  expect(focused).toContain("colour");

  await page.keyboard.press("Delete");
  await settle(page);
  expect(await noteCount(page)).toBe(1);
  expect(first(await notes(page)).text).toBe("keyboard two");

  // The toolbar's bin button removes the other one.
  await clickNote(page, first(await notes(page)).id);
  await deleteNoteButton(page).click();
  await settle(page);
  expect(await noteCount(page)).toBe(0);
  await expect(page.getByRole("toolbar", { name: "Note tools" })).toHaveCount(0);

  const cameraBefore = await readCamera(page);
  const box = await boardBox(page);
  await dragBoard(page, { x: box.x + 100, y: box.y + 100 }, 80, 40);
  expect((await readCamera(page)).x).toBeCloseTo(cameraBefore.x - 80 / cameraBefore.zoom, 6);
});
