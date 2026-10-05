import { expect, test, type Page } from "@playwright/test";
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import { PROSE_1000, RETRO_ITEM, SHORT_PHRASE } from "../fixtures/texts";
import * as board from "./helpers/board";
import * as notes from "./helpers/notes";

/**
 * Story 2, task 8 - sticky notes in a real browser: TC-30 to TC-34 plus the
 * design's three e2e workflows (brainstorm golden path, create while far away,
 * long text). Real font metrics and real pointer gestures live here; the
 * component tests cover the same behaviour without layout.
 */

function noteLocator(page: Page, id: string) {
  return page.locator(`[data-testid='sticky-note'][data-note-id='${id}']`);
}

/** Creates a note by double-click, types into it and returns its id. */
async function createNote(page: Page, at: { x: number; y: number }, text: string): Promise<string> {
  const before = new Set((await notes.notes(page)).map((note) => note.id));
  await notes.createNoteByDoubleClick(page, at);
  await page.keyboard.type(text);
  await notes.endEditing(page);
  const created = (await notes.notes(page)).find((note) => !before.has(note.id));
  if (!created) throw new Error("the new note is missing");
  return created.id;
}

async function zIndexOf(page: Page, id: string): Promise<number> {
  return noteLocator(page, id).evaluate((el) => Number(el.style.zIndex || 0));
}

test.describe("workflow 1: brainstorm golden path", () => {
  test("TC-30 double-click at (400,300) creates a note centred there and typing writes its text", async ({
    page,
  }) => {
    await board.openBoard(page);

    const id = await createNote(page, { x: 400, y: 300 }, "Hello");

    const list = await notes.notes(page);
    expect(list).toHaveLength(1);
    const note = list[0]!;
    expect(note.id).toBe(id);
    const centre = notes.centreOf(note);
    expect(Math.abs(centre.x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - 300)).toBeLessThanOrEqual(1);
    expect(Math.abs(note.box.width - STICKY_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(note.box.height - STICKY_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(note.text).toBe("Hello");
    expect(note.selected).toBe(true);
    await expect(noteLocator(page, id)).toHaveAttribute("aria-label", "Sticky note, yellow");

    // TC-35 in the browser: a double-click on the note itself edits it and does
    // not create a second note.
    await notes.createNoteByDoubleClick(page, { x: 400, y: 300 });
    expect(await notes.noteCount(page)).toBe(1);
    await expect(page.getByTestId("sticky-note-input")).toHaveValue("Hello");
    await notes.endEditing(page);
  });

  test("TC-31 at 50% zoom a 100 x 50 screen pixel drag moves the note 200 x 100 board units, under the pointer", async ({
    page,
  }) => {
    await board.openBoard(page);
    const id = await createNote(page, { x: 500, y: 400 }, SHORT_PHRASE);

    await board.setCamera(page, { ...(await board.readCamera(page)), zoom: 0.5 });

    const before = (await notes.notes(page)).find((note) => note.id === id)!;
    const worldBefore = await notes.worldOf(page, before);
    // Grab 60 x 40 screen pixels inside the note's top-left corner.
    const grab = { x: before.box.x + 60, y: before.box.y + 40 };

    await notes.dragOnBoard(page, grab, 100, 50);

    const after = (await notes.notes(page)).find((note) => note.id === id)!;
    const worldAfter = await notes.worldOf(page, after);
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(100 / 0.5, 1);
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(50 / 0.5, 1);

    // The grabbed point of the note is still under the pointer.
    const grabbedPointNow = { x: after.box.x + 60, y: after.box.y + 40 };
    expect(Math.abs(grabbedPointNow.x - (grab.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(grabbedPointNow.y - (grab.y + 50))).toBeLessThanOrEqual(1);

    // The camera did not move, and the note is still selected with its text.
    const camera = await board.renderedCamera(page);
    expect(camera.zoom).toBeCloseTo(0.5, 6);
    expect(after.selected).toBe(true);
    expect(after.text).toBe(SHORT_PHRASE);
  });

  test("TC-31 recolour through the note toolbar, then delete with the keyboard", async ({ page }) => {
    await board.openBoard(page);
    const doomed = await createNote(page, { x: 400, y: 300 }, "Ship the demo");
    const keeper = await createNote(page, { x: 900, y: 600 }, "Parking lot");
    const keeperWorldBefore = await notes.worldOf(
      page,
      (await notes.notes(page)).find((note) => note.id === keeper)!,
    );

    await board.setCamera(page, { ...(await board.readCamera(page)), zoom: 0.5 });

    // Select the first note and move it at 50% zoom.
    const target = (await notes.notes(page)).find((note) => note.id === doomed)!;
    const before = await notes.worldOf(page, target);
    await notes.dragOnBoard(page, { x: target.box.x + 40, y: target.box.y + 30 }, 100, 50);
    const moved = (await notes.notes(page)).find((note) => note.id === doomed)!;
    const after = await notes.worldOf(page, moved);
    expect(after.x - before.x).toBeCloseTo(200, 1);
    expect(after.y - before.y).toBeCloseTo(100, 1);

    // Recolour it with the swatch named Pink, and it really changes colour.
    await expect(page.getByTestId("note-toolbar")).toBeVisible();
    await page.getByTestId("swatch-pink").click();
    await expect(noteLocator(page, doomed)).toHaveCSS("background-color", notes.rgbOf(STICKY_COLORS.pink));
    expect((await notes.notes(page)).find((note) => note.id === doomed)!.selected).toBe(true);

    // Delete it with the keyboard.
    await page.keyboard.press("Delete");
    await expect(noteLocator(page, doomed)).toHaveCount(0);

    const remaining = await notes.notes(page);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(keeper);
    expect(remaining[0]!.text).toBe("Parking lot");
    const keptWorld = await notes.worldOf(page, remaining[0]!);
    expect(keptWorld.x).toBeCloseTo(keeperWorldBefore.x, 1);
    expect(keptWorld.y).toBeCloseTo(keeperWorldBefore.y, 1);
    await expect(page.getByTestId("note-toolbar")).toHaveCount(0);
  });
});

test.describe("sticky.interaction: stacking at 200% zoom", () => {
  test("TC-32 a 100 x 50 screen pixel drag at 200% zoom moves 50 x 25 board units and draws the note above the one it overlaps", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.setCamera(page, { ...(await board.readCamera(page)), zoom: 2 });

    const below = await createNote(page, { x: 300, y: 300 }, "under");
    const above = await createNote(page, { x: 620, y: 420 }, "over");

    // The point where the two notes overlap is painted as the later one.
    const overlap = { x: 460, y: 350 };
    expect(await notes.paintedNoteIdAt(page, overlap.x, overlap.y)).toBe(above);
    expect(await zIndexOf(page, below)).toBeLessThan(await zIndexOf(page, above));

    const before = await notes.worldOf(page, (await notes.notes(page)).find((note) => note.id === below)!);

    await notes.dragOnBoard(page, { x: 200, y: 200 }, 100, 50);

    const moved = (await notes.notes(page)).find((note) => note.id === below)!;
    const after = await notes.worldOf(page, moved);
    expect(after.x - before.x).toBeCloseTo(100 / 2, 1);
    expect(after.y - before.y).toBeCloseTo(50 / 2, 1);

    // The dragged note is now on top: higher stacking, and it is what the
    // overlap point shows.
    expect(await zIndexOf(page, below)).toBeGreaterThan(await zIndexOf(page, above));
    expect(await notes.paintedNoteIdAt(page, overlap.x, overlap.y)).toBe(below);
  });
});

test.describe("sticky.text: real font layout", () => {
  test("TC-33 short text keeps 24px, longer text shrinks but stays readable, 1,000 characters clip with the fade class", async ({
    page,
  }) => {
    await board.openBoard(page);
    await notes.createNoteByDoubleClick(page, { x: 640, y: 400 });

    const editor = page.getByTestId("sticky-note-input");
    await page.keyboard.type(SHORT_PHRASE);
    await expect(editor).toHaveCSS("font-size", `${STICKY_FONT_MAX_PX}px`);
    await expect(editor).toHaveAttribute("data-overflow", "false");

    // A realistic multi-line retro item: the font shrinks to fit, still above
    // the minimum, and nothing is clipped yet.
    await page.keyboard.press("Enter");
    await page.keyboard.type(RETRO_ITEM);
    const midSize = Number.parseFloat(await editor.evaluate((el) => window.getComputedStyle(el).fontSize));
    expect(midSize).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(midSize).toBeGreaterThan(STICKY_FONT_MIN_PX);
    await expect(editor).toHaveAttribute("data-overflow", "false");
    await expect(page.getByTestId("sticky-note-counter")).toHaveCount(0);

    await editor.fill(PROSE_1000);

    await expect(editor).toHaveClass(/is-overflow/);
    const metrics = await editor.evaluate((el) => ({
      fontPx: Number.parseFloat(window.getComputedStyle(el).fontSize),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(metrics.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(metrics.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    // Clipped, not scrollable: the text is taller than the box and the box
    // hides what does not fit.
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    const clipping = await editor.evaluate((el) => ({
      overflow: window.getComputedStyle(el).overflow,
      height: el.clientHeight,
    }));
    expect(clipping.overflow).toBe("hidden");

    await expect(page.getByTestId("sticky-note-counter")).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );

    await notes.endEditing(page);
    const note = (await notes.notes(page))[0]!;
    expect(note.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    const displayed = await page.getByTestId("sticky-note-text").evaluate((el) => ({
      fontPx: Number.parseFloat(window.getComputedStyle(el).fontSize),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(displayed.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(displayed.scrollHeight).toBeGreaterThan(displayed.clientHeight);
    await expect(page.getByTestId("sticky-note-text")).toHaveClass(/is-overflow/);
    // The counter belongs to editing (PRD: "while editing"), so it is gone once
    // the note leaves Editing, while the clipped text stays visible.
    await expect(page.getByTestId("sticky-note-counter")).toHaveCount(0);
  });

  test("the limit cannot be passed: typing past 1,000 characters keeps exactly 1,000", async ({ page }) => {
    await board.openBoard(page);
    await notes.createNoteByDoubleClick(page, { x: 640, y: 400 });

    const editor = page.getByTestId("sticky-note-input");
    await editor.fill(`${PROSE_1000} and more characters that will not fit`);

    const value = await editor.inputValue();
    expect(value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(value).toBe(PROSE_1000);
  });
});

test.describe("sticky.toolbar: creating while far away", () => {
  test("TC-34 after panning far away the Sticky note tool still puts the note in the middle of the screen", async ({
    page,
  }) => {
    await board.openBoard(page);
    await board.setCamera(page, { x: 1_000_000, y: -750_000, zoom: 1 });

    await page.getByTestId("create-sticky").click();
    await expect(page.getByTestId("sticky-note-input")).toBeVisible();

    const note = (await notes.notes(page))[0]!;
    const centre = notes.centreOf(note);
    const view = await board.boardCentre(page);
    expect(Math.abs(centre.x - view.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - view.y)).toBeLessThanOrEqual(1);

    const area = await board.boardBox(page);
    expect(note.box.x).toBeGreaterThan(area.x);
    expect(note.box.y).toBeGreaterThan(area.y);
    expect(note.box.x + note.box.width).toBeLessThan(area.x + area.width);
    expect(note.box.y + note.box.height).toBeLessThan(area.y + area.height);

    // It is editable where it is visible: typing works immediately.
    await page.keyboard.type("Far away note");
    await notes.endEditing(page);
    expect((await notes.notes(page))[0]!.text).toBe("Far away note");
  });

  test("the note toolbar and its controls do not pan or zoom the board", async ({ page }) => {
    await board.openBoard(page);
    const id = await createNote(page, { x: 640, y: 400 }, "toolbar check");
    await page.getByTestId("sticky-note").click();
    await expect(page.getByTestId("note-toolbar")).toBeVisible();

    const cameraBefore = await board.renderedCamera(page);
    const anchor = page.getByTestId("sticky-note-toolbar-anchor");
    const box = await anchor.boundingBox();
    if (!box) throw new Error("the note toolbar has no bounding box");

    // A drag that starts on the toolbar.
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 150, { steps: 5 });
    await page.mouse.up();
    // A wheel gesture over it.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await notes.settle(page);

    const cameraAfter = await board.renderedCamera(page);
    expect(cameraAfter.x).toBeCloseTo(cameraBefore.x, 3);
    expect(cameraAfter.y).toBeCloseTo(cameraBefore.y, 3);
    expect(cameraAfter.zoom).toBeCloseTo(cameraBefore.zoom, 6);

    // And the note is untouched: still the only one, selected, not edited.
    const list = await notes.notes(page);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.selected).toBe(true);
    await expect(page.getByTestId("sticky-note-input")).toHaveCount(0);
  });
});
