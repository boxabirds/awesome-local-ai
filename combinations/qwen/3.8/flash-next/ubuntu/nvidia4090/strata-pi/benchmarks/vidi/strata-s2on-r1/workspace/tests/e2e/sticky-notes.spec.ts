import { expect, test } from "@playwright/test";
import { boardCentre, openBoard, setCamera } from "./helpers/board";
import {
  createNoteByDoubleClick,
  dragNote,
  endEditingWithEscape,
  expectNear,
  hasEditor,
  isSelected,
  noteCentreOnScreen,
  noteCount,
  noteDisplayText,
  noteIds,
  noteLocator,
  noteScreenSize,
  noteWorldPosition,
  noteZIndex,
} from "./helpers/stickies";

/**
 * sticky.interaction, e2e level: real pointer gestures on a real browser, so
 * pixel-accurate centring and drag geometry are checked on painted output.
 */
test.describe("sticky notes: create, select, move", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("TC-30: double-click creates a note centred on the pointer and typing goes straight in", async ({
    page,
  }) => {
    const id = await createNoteByDoubleClick(page, 400, 300);
    await page.keyboard.type("Hello");

    // The note is centred on the point that was double-clicked.
    await expectNear(await noteCentreOnScreen(page, id), { x: 400, y: 300 }, 1);

    await endEditingWithEscape(page);
    expect(await noteDisplayText(page, id)).toBe("Hello");
    expect(await isSelected(page, id)).toBe(true);
    expect(await noteCount(page)).toBe(1);

    // Board units at 100% zoom: 200 x 200 CSS pixels.
    const size = await noteScreenSize(page, id);
    expect(size.width).toBeCloseTo(200, 0);
    expect(size.height).toBeCloseTo(200, 0);
  });

  test("TC-31: at 50% zoom a drag of (100, 50) screen pixels moves the note by (200, 100) board units", async ({
    page,
  }) => {
    const camera = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!camera) throw new Error("camera test hook is missing");

    const id = await createNoteByDoubleClick(page, 640, 400);
    await endEditingWithEscape(page);

    await setCamera(page, { ...camera, zoom: 0.5 });
    expect(await noteScreenSize(page, id).then((s) => s.width)).toBeCloseTo(100, 0);

    const before = await noteWorldPosition(page, id);
    const centreBefore = await noteCentreOnScreen(page, id);
    const grab = await dragNote(page, id, 100, 50);

    const after = await noteWorldPosition(page, id);
    expect(after.x - before.x).toBeCloseTo(200, 1);
    expect(after.y - before.y).toBeCloseTo(100, 1);

    // The point that was grabbed stays under the pointer.
    const centreAfter = await noteCentreOnScreen(page, id);
    await expectNear(centreAfter, { x: grab.x + 100, y: grab.y + 50 }, 1);
    await expectNear(
      { x: centreAfter.x - centreBefore.x, y: centreAfter.y - centreBefore.y },
      { x: 100, y: 50 },
      1,
    );
    expect(await isSelected(page, id)).toBe(true);
  });

  test("TC-32: at 200% zoom a drag of (100, 50) moves by (50, 25) and the note is drawn above the one it overlaps", async ({
    page,
  }) => {
    const camera = await page.evaluate(() => window.__vidi6?.getCamera());
    if (!camera) throw new Error("camera test hook is missing");
    await setCamera(page, { ...camera, zoom: 2 });

    const lower = await createNoteByDoubleClick(page, 400, 300);
    await endEditingWithEscape(page);
    const top = await createNoteByDoubleClick(page, 700, 600);
    await endEditingWithEscape(page);

    const before = await noteWorldPosition(page, lower);
    await dragNote(page, lower, 100, 50);
    const after = await noteWorldPosition(page, lower);
    expect(after.x - before.x).toBeCloseTo(50, 1);
    expect(after.y - before.y).toBeCloseTo(25, 1);

    const boxA = await noteLocator(page, lower).boundingBox();
    const boxB = await noteLocator(page, top).boundingBox();
    if (!boxA || !boxB) throw new Error("notes have no bounding boxes");
    const left = Math.max(boxA.x, boxB.x);
    const right = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const topEdge = Math.max(boxA.y, boxB.y);
    const bottom = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);
    expect(right - left).toBeGreaterThan(1);
    expect(bottom - topEdge).toBeGreaterThan(1);

    const overlap = { x: (left + right) / 2, y: (topEdge + bottom) / 2 };
    const painted = await page.evaluate((point) => {
      const el = document.elementFromPoint(point.x, point.y);
      const note = el ? el.closest(".sticky-note") : null;
      return note ? note.getAttribute("data-note-id") : null;
    }, overlap);
    expect(painted).toBe(lower);

    // Painting order follows z, and the dragged note is on top of the other.
    expect(await noteZIndex(page, lower)).toBeGreaterThan(await noteZIndex(page, top));
  });

  test("dragging a note does not pan the board and does not move the other notes", async ({ page }) => {
    const cameraBefore = await page.evaluate(() => window.__vidi6?.getCamera());
    const first = await createNoteByDoubleClick(page, 300, 300);
    await endEditingWithEscape(page);
    const second = await createNoteByDoubleClick(page, 900, 600);
    await endEditingWithEscape(page);

    const secondBefore = await noteWorldPosition(page, second);
    const screenBefore = await noteCentreOnScreen(page, second);

    await dragNote(page, first, 120, -60);

    const cameraAfter = await page.evaluate(() => window.__vidi6?.getCamera());
    expect(cameraAfter).toEqual(cameraBefore);
    const secondAfter = await noteWorldPosition(page, second);
    expect(secondAfter).toEqual(secondBefore);
    await expectNear(await noteCentreOnScreen(page, second), screenBefore, 1);
  });

  test("a press on a note selects it and a click on empty board space deselects it", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await endEditingWithEscape(page);
    expect(await isSelected(page, id)).toBe(true);

    await page.mouse.click(200, 700);
    expect(await isSelected(page, id)).toBe(false);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);

    const centre = await noteCentreOnScreen(page, id);
    await page.mouse.click(centre.x, centre.y);
    expect(await isSelected(page, id)).toBe(true);
    await expect(page.getByTestId("note-toolbar")).toBeVisible();
    expect(await noteCount(page)).toBe(1);
  });

  test("TC-35: double-clicking a note edits it instead of creating another one", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await endEditingWithEscape(page);

    const centre = await noteCentreOnScreen(page, id);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect(page.getByTestId("sticky-note-textarea")).toBeVisible();
    expect(await noteCount(page)).toBe(1);
    expect(await hasEditor(page)).toBe(true);

    await page.keyboard.type(" more");
    await endEditingWithEscape(page);
    expect(await noteDisplayText(page, id)).toBe(" more");
  });

  test("Delete and Backspace remove a selected note but never while editing", async ({ page }) => {
    const editing = await createNoteByDoubleClick(page, 300, 600);
    await page.keyboard.type("ab");
    await page.keyboard.press("Backspace");
    expect(await noteCount(page)).toBe(1);
    expect(await noteDisplayText(page, editing)).toBe("a");
    await endEditingWithEscape(page);

    const selected = await createNoteByDoubleClick(page, 900, 300);
    await endEditingWithEscape(page);
    expect(await isSelected(page, selected)).toBe(true);
    await page.keyboard.press("Delete");
    await expect(noteLocator(page, selected)).toHaveCount(0);
    expect(await noteCount(page)).toBe(1);

    // The note that is still there was left untouched.
    expect(await noteDisplayText(page, editing)).toBe("a");
  });

  test("the board start point stays put while notes are added", async ({ page }) => {
    const centre = await boardCentre(page);
    await createNoteByDoubleClick(page, centre.x, centre.y);
    await endEditingWithEscape(page);
    const position = await noteWorldPosition(page, (await noteIds(page))[0]);
    expect(position.x).toBeCloseTo(-100, 1);
    expect(position.y).toBeCloseTo(-100, 1);
  });
});
