// End-to-end sticky note workflows in real browsers. The TC ids are the Acceptance
// Cases in spec/stories/002-capture-ideas-on-sticky-notes-and-rearrange-them/design.md.
//
// Run against the test build (MODE=test) so the camera can be jumped to 50% or
// 200% instead of pinching a hundred times, and so a pan far away is one call.
// Everything else is a real mouse and keyboard: real double-clicks, real drags,
// real typing, and real pixels read back from a screenshot.

import { expect, test, type Page } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { PROSE_1000, PROSE_1200 } from '../fixtures/texts';
import {
  areaCentre,
  expectPixels,
  openFreshBoard,
  pageZoom,
  readCamera,
  setCamera,
  settledCamera,
} from './helpers/board';
import { Screenshot } from './helpers/pixels';

/** A note as the board says it is, read from its rendered element. */
interface NoteOnScreen {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  selected: boolean;
  editing: boolean;
}

const noteList = (page: Page) => page.locator('[data-testid="sticky-note"]');
const noteAt = (page: Page, index: number) => noteList(page).nth(index);
/** A note by id: the painted order changes when a note is raised to the top. */
const noteById = (page: Page, id: string) => page.locator(`[data-note-id="${id}"]`);
const editor = (page: Page) => page.locator('textarea[data-testid="sticky-text"]');
const stickyTool = (page: Page) => page.getByRole('button', { name: 'Sticky note', exact: true });
const noteTools = (page: Page) => page.getByRole('toolbar', { name: 'Note tools' });
const swatch = (page: Page, color: string) =>
  page.getByRole('button', { name: `${color.charAt(0).toUpperCase()}${color.slice(1)} colour` });
const deleteNoteButton = (page: Page) => page.getByRole('button', { name: 'Delete note' });

async function noteData(page: Page, index: number): Promise<NoteOnScreen> {
  return noteAt(page, index).evaluate((el) => ({
    id: String((el as HTMLElement).dataset.noteId),
    x: Number((el as HTMLElement).dataset.noteX),
    y: Number((el as HTMLElement).dataset.noteY),
    z: Number((el as HTMLElement).dataset.noteZ),
    color: String((el as HTMLElement).dataset.color),
    selected: (el as HTMLElement).dataset.selected === 'true',
    editing: (el as HTMLElement).dataset.editing === 'true',
  }));
}

/** The note's box in screen (CSS) pixels, as the browser laid it out. */
async function noteBox(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number; cx: number; cy: number }> {
  const box = await noteAt(page, index).boundingBox();
  if (box === null) throw new Error(`note ${index} is not rendered`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

async function noteDataById(page: Page, id: string): Promise<NoteOnScreen> {
  return noteById(page, id).evaluate((el) => ({
    id: String((el as HTMLElement).dataset.noteId),
    x: Number((el as HTMLElement).dataset.noteX),
    y: Number((el as HTMLElement).dataset.noteY),
    z: Number((el as HTMLElement).dataset.noteZ),
    color: String((el as HTMLElement).dataset.color),
    selected: (el as HTMLElement).dataset.selected === 'true',
    editing: (el as HTMLElement).dataset.editing === 'true',
  }));
}

async function noteBoxById(page: Page, id: string) {
  const box = await noteById(page, id).boundingBox();
  if (box === null) throw new Error(`note ${id} is not rendered`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

async function noteCount(page: Page): Promise<number> {
  return noteList(page).count();
}

/** The note's text as it is drawn (not counting the note's own tools). */
async function visibleText(page: Page, index: number): Promise<string> {
  return (await noteAt(page, index).locator('[data-testid="sticky-text"]').textContent()) ?? '';
}

/** Computed font size of the note's text, in CSS pixels. */
async function textFontPx(page: Page, index: number): Promise<number> {
  const size = await noteAt(page, index)
    .locator('[data-testid="sticky-text"]')
    .evaluate((el) => getComputedStyle(el).fontSize);
  return Number.parseFloat(size);
}

/** Note ids in the order the board paints them; the last one is on top. */
/**
 * Which note is drawn on top: notes are stacked by their z value, so the highest
 * is the one that paints over the others. TC-32 confirms this from real pixels.
 */
async function stackOrder(page: Page): Promise<string[]> {
  const notes = await noteList(page).evaluateAll((els) =>
    els
      .map((el, position) => ({ id: String((el as HTMLElement).dataset.noteId), z: Number((el as HTMLElement).dataset.noteZ), position }))
      .sort((a, b) => a.z - b.z || a.position - b.position),
  );
  return notes.map((note) => note.id);
}

/**
 * How far apart the colour channels are over a patch of screen, in the pixels the
 * browser actually painted: the note colours are far enough apart (pink 101,
 * green 60) to tell which note is on top of the other where they overlap.
 */
async function spreadAt(shot: Screenshot, x: number, y: number): Promise<number> {
  const samples: number[] = [];
  for (let row = y - 5; row <= y + 5; row += 1) {
    const strip = await shot.strip(row, x - 5, x + 5);
    samples.push(...strip.map((pixel) => pixel.colourSpread));
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** Double-click empty board space, so the note lands centred on that point. */
async function doubleClickBoard(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await expect.poll(() => editor(page).count(), { timeout: 5_000 }).toBe(1);
}

/** Drag a note with the real mouse from a point inside it, in `steps` moves. */
async function dragNoteByMouse(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  grab?: { x: number; y: number },
  steps = 10,
): Promise<void> {
  const from = grab ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

/** Wait for the note's rendered position to settle at its last write. */
/** Wait until the note with this id stops moving: drags are written per frame. */
async function settledNote(page: Page, id: string): Promise<NoteOnScreen> {
  let previous = await noteDataById(page, id);
  await expect
    .poll(
      async () => {
        const next = await noteDataById(page, id);
        const stable = next.x === previous.x && next.y === previous.y && next.z === previous.z;
        previous = next;
        return stable;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  return noteDataById(page, id);
}

async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

/** A point on empty board space, clear of every fixed control. */
const EMPTY_BOARD = { x: 180, y: 720 };

test.beforeEach(async ({ page, request }) => {
  await openFreshBoard(page, request);
  await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible();
});

test('TC-30 brainstorm golden path: double-click, type, recolour, delete', async ({ page }) => {
  const camera = await settledCamera(page);

  await doubleClickBoard(page, 400, 300);

  // the note is centred on the point that was clicked
  const box = await noteBox(page, 0);
  expectPixels(box.cx, 400);
  expectPixels(box.cy, 300);
  expectPixels(box.width, STICKY_SIZE_WORLD);
  expect(await editor(page).inputValue()).toBe('');

  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');

  expect(await visibleText(page, 0)).toBe('Hello');
  expect(await noteData(page, 0)).toMatchObject({ color: 'yellow', selected: true });

  // the note tools name their colours, and choosing one keeps the note selected
  await expect(noteTools(page)).toBeVisible();
  await expect(swatch(page, 'green')).toHaveAttribute('aria-pressed', 'false');
  await swatch(page, 'green').click();
  expect(await noteData(page, 0)).toMatchObject({ color: 'green', selected: true });
  await expect(swatch(page, 'green')).toHaveAttribute('aria-pressed', 'true');
  expect(await visibleText(page, 0)).toBe('Hello');

  // clicking empty board space deselects the note and hides its tools
  await clickAt(page, EMPTY_BOARD.x, EMPTY_BOARD.y);
  expect(await noteData(page, 0).then((note) => note.selected)).toBe(false);
  await expect(noteTools(page)).toHaveCount(0);

  // selecting it again and pressing Delete takes the note off the board
  await clickAt(page, 400, 300);
  expect(await noteData(page, 0).then((note) => note.selected)).toBe(true);
  await page.keyboard.press('Delete');
  await expect.poll(() => noteCount(page)).toBe(0);

  // negative: none of that panned or zoomed the board
  expect(await settledCamera(page)).toEqual(camera);
});

test('TC-30 a double-click on a note edits it instead of adding another', async ({ page }) => {
  await doubleClickBoard(page, 500, 400);
  await page.keyboard.type('one');
  await page.keyboard.press('Escape');

  await noteAt(page, 0).dblclick();

  await expect.poll(() => noteCount(page)).toBe(1);
  expect(await editor(page).inputValue()).toBe('one');
  expect(await noteData(page, 0)).toMatchObject({ selected: true });
});

test('TC-31 at 50% zoom a drag moves the note by twice as much world and keeps the point under the pointer', async ({ page }) => {
  await setCamera(page, { x: -300, y: -160, zoom: 0.5 });
  const camera = await settledCamera(page);

  await doubleClickBoard(page, 700, 400);
  await page.keyboard.press('Escape');
  const before = await noteData(page, 0);
  const boxBefore = await noteBox(page, 0);

  await dragNoteByMouse(page, boxBefore, 100, 50);

  const after = await settledNote(page, before.id);
  // the board is at half size, so 100 screen pixels are 200 world units
  expectPixels(after.x, before.x + 100 / camera.zoom, 1.5);
  expectPixels(after.y, before.y + 50 / camera.zoom, 1.5);

  // the point that was grabbed stays under the pointer: the note moved by exactly
  // the pointer's travel on screen
  const boxAfter = await noteBox(page, 0);
  expectPixels(boxAfter.cx, boxBefore.cx + 100);
  expectPixels(boxAfter.cy, boxBefore.cy + 50);
  // half scale: the note is drawn at half its world size, and stayed that size
  expectPixels(boxAfter.width, STICKY_SIZE_WORLD * camera.zoom);

  // negative: grabbing a note is never a pan
  expect(await settledCamera(page)).toEqual(camera);
});

test('TC-32 at 200% zoom a drag lands half as far in world units and lands on top', async ({ page }) => {
  await setCamera(page, { x: -140, y: -60, zoom: 2 });
  const camera = await settledCamera(page);

  // two notes that overlap each other part-way, in colours that say which is which
  await doubleClickBoard(page, 400, 350);
  await page.keyboard.press('Escape');
  const first = await noteData(page, 0);
  await doubleClickBoard(page, 700, 500);
  await page.keyboard.press('Escape');
  const second = await noteData(page, 1);
  expect(await stackOrder(page)).toEqual([first.id, second.id]);

  await clickAt(page, 250, 200); // the part of the first note the second does not cover
  await swatch(page, 'pink').click();
  await clickAt(page, 850, 650);
  await swatch(page, 'green').click();

  // grab the first note somewhere the second one does not cover it
  const box = await noteBoxById(page, first.id);
  await dragNoteByMouse(page, box, 100, 50, { x: box.x + 60, y: box.y + 60 });

  const after = await settledNote(page, first.id);
  // double size: 100 screen pixels are 50 world units
  expectPixels(after.x, first.x + 100 / camera.zoom, 1.5);
  expectPixels(after.y, first.y + 50 / camera.zoom, 1.5);

  // the note that was dragged is now stacked above the one it crossed, and the
  // note it crossed was not moved by the drag
  expect(after.z).toBeGreaterThan(second.z);
  expect(await stackOrder(page)).toEqual([second.id, first.id]);
  expect(await noteDataById(page, second.id)).toMatchObject({ x: second.x, y: second.y });

  // where the two overlap, the browser painted the dragged note's pink, not the
  // green note underneath it
  const over = await noteBoxById(page, first.id);
  const under = await noteBoxById(page, second.id);
  const crossing = {
    x: Math.round((Math.max(over.x, under.x) + Math.min(over.x + over.width, under.x + under.width)) / 2),
    y: Math.round((Math.max(over.y, under.y) + Math.min(over.y + over.height, under.y + under.height)) / 2),
  };
  const shot = await Screenshot.capture(page);
  const onTop = await spreadAt(shot, crossing.x, crossing.y);
  const underneath = await spreadAt(shot, under.x + under.width - 40, under.y + under.height - 40);
  await shot.close();
  expect(onTop).toBeGreaterThan(85); // pink: the note that was dragged
  expect(underneath).toBeLessThan(80); // green: the note that stayed

  // and the dragged note got there without its element being moved in the board,
  // which is what lets a drag raise a note without losing the pointer holding it
  expect(await noteList(page).evaluateAll((els) => els.map((el) => String((el as HTMLElement).dataset.noteId)))).toEqual([
    first.id,
    second.id,
  ]);
});

test('TC-31 the note tools keep their size on screen at any zoom', async ({ page }) => {
  const widths: number[] = [];
  for (const zoom of [0.5, 1, 2]) {
    await setCamera(page, { x: -200, y: -120, zoom });
    await doubleClickBoard(page, 640, 400);
    await page.keyboard.type('tools');
    await page.keyboard.press('Escape');
    const toolbar = await noteTools(page).boundingBox();
    if (toolbar === null) throw new Error('the note tools are not shown for the selected note');
    widths.push(toolbar.width);
    await clickAt(page, EMPTY_BOARD.x, EMPTY_BOARD.y);
    await noteAt(page, 0).waitFor();
  }

  expectPixels(widths[1], widths[0], 2);
  expectPixels(widths[2], widths[1], 2);
});

/** Darkest pixel luminance in a band of rows, sampled one pixel per row. */
async function darkestIn(
  shot: Screenshot,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
): Promise<number> {
  let darkest = Number.POSITIVE_INFINITY;
  for (let y = Math.round(y0); y <= Math.round(y1); y += 1) {
    const strip = await shot.strip(y, x0, x1);
    darkest = Math.min(darkest, ...strip.map((pixel) => pixel.luminance));
  }
  return darkest;
}

test('TC-33 long text shrinks to fit, says so, and never draws outside the note', async ({ page }) => {
  await doubleClickBoard(page, 640, 400);

  // a short idea is written at the largest size
  await page.keyboard.type('Ship it');
  expect(Math.round(await editor(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)))).toBe(
    STICKY_FONT_MAX_PX,
  );
  await page.keyboard.press('Escape');
  expect(Math.round(await textFontPx(page, 0))).toBe(STICKY_FONT_MAX_PX);

  // a whole paragraph: the text gets smaller, but stays readable
  await noteAt(page, 0).dblclick();
  await page.keyboard.insertText(PROSE_1000);
  const fitting = await editor(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fitting).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fitting).toBeLessThan(STICKY_FONT_MAX_PX);
  // the paragraph was added where the caret was, and the note kept the first
  // thousand characters of the result
  expect(await editor(page).inputValue()).toBe(`Ship it${PROSE_1000}`.slice(0, STICKY_TEXT_MAX_CHARS));

  // more than the note can hold: nothing further makes it in
  await page.keyboard.insertText(PROSE_1200);
  expect(await editor(page).inputValue()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  await expect(page.getByTestId('sticky-counter')).toHaveText(
    `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
  );

  // the note says the rest is hidden
  await clickAt(page, EMPTY_BOARD.x, EMPTY_BOARD.y);
  await expect.poll(() => noteCount(page)).toBe(1);
  expect(await visibleText(page, 0)).toHaveLength(STICKY_TEXT_MAX_CHARS);
  await expect(noteAt(page, 0).locator('.sticky-fade')).toHaveCount(1);
  expect(await textFontPx(page, 0)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);

  // and nothing of it is painted outside the note. The rows inside the note hold
  // dark ink; the rows of board directly above and below it hold board, the
  // note's shadow and grid dots only - never ink.
  const box = await noteBox(page, 0);
  const shot = await Screenshot.capture(page);
  const insideNote = await darkestIn(shot, box.y + 20, box.y + box.height - 40, box.x + 16, box.x + box.width - 16);
  const boardBelow = await darkestIn(
    shot,
    box.y + box.height + 2,
    box.y + box.height + 20,
    box.x + 4,
    box.x + box.width - 4,
  );
  const boardAbove = await darkestIn(shot, box.y - 20, box.y - 2, box.x + 4, box.x + box.width - 4);
  const boardRight = await darkestIn(
    shot,
    box.y + 30,
    box.y + box.height - 30,
    box.x + box.width + 2,
    box.x + box.width + 20,
  );
  await shot.close();
  expect(insideNote).toBeLessThan(120); // the shrunken text is there to be found
  expect(boardBelow).toBeGreaterThan(110); // no line of it hung below the note
  expect(boardAbove).toBeGreaterThan(110); // and none of it started above
  expect(boardRight).toBeGreaterThan(110); // or beside it
});

test('TC-34 the Sticky note tool puts a note in the middle of the board, however far away it is', async ({ page }) => {
  for (const camera of [
    { x: 50_000, y: -30_000, zoom: 1 },
    { x: -999_999, y: 123_456, zoom: 0.5 },
    { x: 12_345, y: 6_789, zoom: 2 },
  ]) {
    await setCamera(page, camera);
    const zoom = camera.zoom;
    const before = await readCamera(page);

    await stickyTool(page).click();
    await expect.poll(() => noteCount(page)).toBe(1);

    const centre = await areaCentre(page);
    const box = await noteBox(page, 0);
    expectPixels(box.cx, centre.x);
    expectPixels(box.cy, centre.y);
    expectPixels(box.width, STICKY_SIZE_WORLD * zoom);
    // and it is ready to type in straight away
    expect(await editor(page).inputValue()).toBe('');
    await page.keyboard.type('here');
    await page.keyboard.press('Escape');
    expect(await visibleText(page, 0)).toBe('here');

    // leave the board empty for the next camera, and the board itself unmoved
    await page.keyboard.press('Delete');
    await expect.poll(() => noteCount(page)).toBe(0);
    expect(await readCamera(page)).toEqual(before);
  }
});

test('TC-34 the tools never change the browser page zoom', async ({ page }) => {
  const before = await pageZoom(page);

  await stickyTool(page).click();
  await page.keyboard.press('Escape');
  await swatch(page, 'violet').click();
  await deleteNoteButton(page).click();

  expect(await pageZoom(page)).toEqual(before);
  expect(await noteCount(page)).toBe(0);
});
