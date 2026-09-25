import { expect, test, type Page } from '@playwright/test';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, SHORT_PHRASE } from '../fixtures/texts';
import {
  PIXEL_TOLERANCE,
  boxOf,
  getCamera,
  getNotes,
  nextFrames,
  noteLocator,
  openBoard,
  setCamera,
  viewportCentre,
} from './helpers/board';

const HALF = 2;
const DRAG = { dx: 100, dy: 50 } as const;
const DRAG_STEPS = 10;
const EMPTY_SPOT = { x: 1000, y: 650 } as const;

/** Hex "#RRGGBB" → computed "rgb(r, g, b)". */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function centreOf(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / HALF, y: box.y + box.height / HALF };
}

async function onlyNote(page: Page) {
  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  return notes[0]!;
}

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Note text' });
}

/** Double-clicks empty board, checks edit mode, types `text`, presses Escape. Returns the new id. */
async function createNote(page: Page, at: { x: number; y: number }, text = ''): Promise<string> {
  const before = new Set((await getNotes(page)).map((n) => n.id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  const created = (await getNotes(page)).find((n) => !before.has(n.id));
  if (!created) throw new Error('no note created');
  return created.id;
}

/** Real mouse drag; checks mid-drag that the grabbed point stays under the pointer. */
async function dragNote(page: Page, id: string, grab: { x: number; y: number }) {
  const box0 = await boxOf(page, id);
  const offset = { x: grab.x - box0.x, y: grab.y - box0.y };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + DRAG.dx, grab.y + DRAG.dy, { steps: DRAG_STEPS });
  await nextFrames(page);
  const mid = await boxOf(page, id);
  expect(Math.abs(mid.x + offset.x - (grab.x + DRAG.dx))).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(Math.abs(mid.y + offset.y - (grab.y + DRAG.dy))).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  await page.mouse.up();
  await nextFrames(page);
}

test.describe('Workflow: brainstorm golden path', () => {
  test('TC-30 → TC-31 → recolour → delete', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toHaveAttribute(
      'title',
      'Sticky note – or double-click the board',
    );

    // TC-30: double-click creates a yellow note centred on the point, typing goes straight in.
    const at = { x: 400, y: 300 };
    await page.mouse.dblclick(at.x, at.y);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Hello');
    const note = await onlyNote(page);
    expect(note.text).toBe('Hello');
    expect(note.color).toBe('yellow');
    const box = await boxOf(page, note.id);
    const centre = centreOf(box);
    expect(Math.abs(centre.x - at.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(centre.y - at.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);

    // Clicking empty board ends editing, keeps the text and clears the selection.
    await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expect(editor(page)).toHaveCount(0);
    await expect(noteLocator(page, note.id)).toHaveText('Hello');
    await expect(noteLocator(page, note.id)).toHaveAttribute('data-selected', 'false');

    // TC-31: at 50% zoom, a real drag by (100, 50) keeps the grabbed point under the pointer
    // and moves the note by (200, 100) world units. The board view does not move.
    const zoom = 0.5;
    await setCamera(page, { x: -1000, y: -600, zoom });
    await nextFrames(page);
    const cameraBefore = await getCamera(page);
    const small = await boxOf(page, note.id);
    expect(small.width).toBeCloseTo(STICKY_SIZE_WORLD * zoom, 0);
    const grab = { x: small.x + small.width / 4, y: small.y + small.height / 4 };
    await dragNote(page, note.id, grab);
    const moved = await onlyNote(page);
    expect(Math.abs(moved.x - note.x - DRAG.dx / zoom)).toBeLessThanOrEqual(PIXEL_TOLERANCE / zoom);
    expect(Math.abs(moved.y - note.y - DRAG.dy / zoom)).toBeLessThanOrEqual(PIXEL_TOLERANCE / zoom);
    expect(await getCamera(page)).toEqual(cameraBefore);
    await expect(noteLocator(page, note.id)).toHaveAttribute('data-selected', 'true');

    // Recolour via the floating toolbar: colour changes, text/position/selection do not.
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect(noteLocator(page, note.id)).toHaveCSS('background-color', rgb(STICKY_COLORS.green));
    const green = await onlyNote(page);
    expect(green).toEqual({ ...moved, color: 'green' });
    await expect(noteLocator(page, note.id)).toHaveAttribute('data-selected', 'true');

    // A duplicate note, selected, removed with the Delete key.
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await nextFrames(page);
    const dup = await createNote(page, { x: 900, y: 250 }, 'Hello');
    await expect(noteLocator(page, dup)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(noteLocator(page, dup)).toHaveCount(0);

    // Board ends with exactly the moved green note.
    const final = await getNotes(page);
    expect(final).toEqual([green]);
    await expect(noteLocator(page)).toHaveCount(1);
  });
});

test('TC-32 at 200% zoom a drag moves by (50, 25) world units and draws the note on top', async ({ page }) => {
  await openBoard(page);
  const a = await createNote(page, { x: 500, y: 400 }, 'Dragged');
  const b = await createNote(page, { x: 700, y: 400 }, 'Below');
  const zoom = 2;
  await setCamera(page, { x: -300, y: -150, zoom });
  await nextFrames(page);
  const before = (await getNotes(page)).find((n) => n.id === a)!;
  expect((await getNotes(page)).at(-1)?.id).toBe(b);

  const boxA = await boxOf(page, a);
  await dragNote(page, a, centreOf(boxA));
  const after = (await getNotes(page)).find((n) => n.id === a)!;
  expect(Math.abs(after.x - before.x - DRAG.dx / zoom)).toBeLessThanOrEqual(PIXEL_TOLERANCE / zoom);
  expect(Math.abs(after.y - before.y - DRAG.dy / zoom)).toBeLessThanOrEqual(PIXEL_TOLERANCE / zoom);
  expect((await getNotes(page)).at(-1)?.id).toBe(a);

  // A point inside both notes shows the dragged note.
  const boxB = await boxOf(page, b);
  const moved = await boxOf(page, a);
  const overlap = {
    x: (Math.max(moved.x, boxB.x) + Math.min(moved.x + moved.width, boxB.x + boxB.width)) / HALF,
    y: (Math.max(moved.y, boxB.y) + Math.min(moved.y + moved.height, boxB.y + boxB.height)) / HALF,
  };
  expect(overlap.x).toBeGreaterThan(boxB.x);
  expect(overlap.x).toBeLessThan(moved.x + moved.width);
  const topId = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[role="group"]')?.dataset.id,
    overlap,
  );
  expect(topId).toBe(a);
});

test('TC-33 text fits: one word at the largest size, 1,000 characters shrink then clip with a fade', async ({ page }) => {
  await openBoard(page);
  await page.mouse.dblclick(640, 250);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(SHORT_PHRASE.split(' ')[0]!);
  const note = noteLocator(page);
  const body = note.locator('.sticky-note__body');
  await expect(body).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(PROSE_1000);
  await expect(editor(page)).toHaveValue(PROSE_1000);
  await expect(note).toHaveClass(/sticky-note--overflow/);
  await expect(note.locator('.sticky-note__fade')).toHaveCount(1);
  await page.keyboard.press('Escape');

  const fontPx = parseFloat(await body.evaluate((el) => getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
  const clip = await body.evaluate((el) => ({
    overflow: getComputedStyle(el).overflow,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(clip.overflow).toBe('hidden');
  expect(clip.scrollHeight).toBeGreaterThan(clip.clientHeight);
  // Nothing is drawn outside the note: the clipping body is exactly the note's box.
  const noteBox = await note.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(bodyBox).toEqual(noteBox);
  const text = await note.locator('[data-testid="sticky-text"]').boundingBox();
  expect(text!.y).toBeGreaterThanOrEqual(noteBox!.y - PIXEL_TOLERANCE); // overflow goes down only
  expect((await getNotes(page))[0]!.text).toBe(PROSE_1000);
});

test('pasting 1,200 characters keeps 1,000 and the counter shows 1000/1000', async ({ page }) => {
  await openBoard(page);
  await page.mouse.dblclick(640, 250);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.insertText(PROSE_1200);
  await expect(editor(page)).toHaveValue(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  await expect(page.getByTestId('sticky-counter')).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  expect((await getNotes(page))[0]!.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
});

test('TC-34 Sticky note button creates a note at the centre of the view when panned far away', async ({ page }) => {
  await openBoard(page);
  const far = UNBOUNDED_PAN_TESTED_EXTENT;
  await setCamera(page, { x: far, y: far, zoom: 1 });
  await nextFrames(page);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Far away');
  const note = await onlyNote(page);
  await expect(noteLocator(page, note.id)).toBeInViewport();
  const centre = centreOf(await boxOf(page, note.id));
  const view = await viewportCentre(page);
  expect(Math.abs(centre.x - view.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(Math.abs(centre.y - view.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  expect(note.text).toBe('Far away');
});

test('Enter edits a selected note; Backspace while editing edits text; Backspace when selected deletes', async ({ page }) => {
  await openBoard(page);
  const id = await createNote(page, { x: 400, y: 300 }, 'ab');
  await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
  await noteLocator(page, id).click();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Backspace');
  expect((await onlyNote(page)).text).toBe('a');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await expect(noteLocator(page)).toHaveCount(0);
});
