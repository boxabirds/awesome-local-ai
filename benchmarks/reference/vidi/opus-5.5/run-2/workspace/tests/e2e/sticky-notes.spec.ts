import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { LONG_PARAGRAPH, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import { expectNear, getCamera, openBoard, originMarkerCentre, setCamera } from './helpers/board';

const DRAG = { dx: 100, dy: 50 };
const DRAG_STEPS = 10;
const HALF_ZOOM = 0.5;
const DOUBLE_ZOOM = 2;
const DBLCLICK_AT: Point = { x: 400, y: 300 };

function notes(page: Page): Locator {
  return page.getByRole('group', { name: 'Sticky note' });
}

async function centreOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The note's top-left in world units, read from its layout position. */
async function worldPos(note: Locator): Promise<Point> {
  return note.evaluate((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Sets a new zoom keeping the world point under `screen` (default: the centre) fixed. */
async function zoomAround(page: Page, zoom: number, screen?: Point): Promise<void> {
  const cam = await getCamera(page);
  const viewport = page.viewportSize()!;
  const p = screen ?? { x: viewport.width / 2, y: viewport.height / 2 };
  const world = { x: cam.x + p.x / cam.zoom, y: cam.y + p.y / cam.zoom };
  await setCamera(page, { x: world.x - p.x / zoom, y: world.y - p.y / zoom, zoom });
}

async function createByDoubleClick(page: Page, at: Point, text: string): Promise<Locator> {
  const before = await notes(page).count();
  await page.mouse.dblclick(at.x, at.y);
  await expect(notes(page)).toHaveCount(before + 1);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type(text);
  const id = await editor.evaluate((el) => (el.closest('[data-id]') as HTMLElement).dataset.id!);
  return page.locator(`[data-id="${id}"]`);
}

/** Drags from `from` by DRAG in small steps, checking the grabbed point follows the pointer. */
async function dragNote(page: Page, note: Locator, from: Point): Promise<void> {
  const boxBefore = (await note.boundingBox())!;
  const offset = { x: from.x - boxBefore.x, y: from.y - boxBefore.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + DRAG.dx / 2, from.y + DRAG.dy / 2, { steps: DRAG_STEPS });
  // Mid-drag: the grabbed point is under the pointer.
  await expect
    .poll(async () => {
      const b = (await note.boundingBox())!;
      return Math.max(
        Math.abs(b.x + offset.x - (from.x + DRAG.dx / 2)),
        Math.abs(b.y + offset.y - (from.y + DRAG.dy / 2)),
      );
    })
    .toBeLessThanOrEqual(1);
  await expect(page.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
  await page.mouse.move(from.x + DRAG.dx, from.y + DRAG.dy, { steps: DRAG_STEPS });
  await page.mouse.up();
}

test.describe('Workflow 1: brainstorm golden path', () => {
  test('TC-30 → TC-31 → recolour → delete', async ({ page }) => {
    await openBoard(page);

    // TC-30: double-click empty board, type immediately.
    const note = await createByDoubleClick(page, DBLCLICK_AT, 'Hello');
    expectNear(await centreOf(note), DBLCLICK_AT);
    await expect(note).toHaveAttribute('data-color', 'yellow');
    await expect(note).toHaveCSS('background-color', hexToRgb(STICKY_COLORS.yellow));
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('Hello');

    // Click empty board space: editing ends, text kept, not selected.
    await page.mouse.click(1000, 650);
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    await expect(note).toContainText('Hello');
    await expect(note).toHaveAttribute('data-selected', 'false');

    // TC-31: at 50% the grabbed point stays under the pointer; world moves by 2×.
    await zoomAround(page, HALF_ZOOM);
    const cameraBefore = await getCamera(page);
    const markerBefore = await originMarkerCentre(page);
    const worldBefore = await worldPos(note);
    const grab = await centreOf(note);
    const grabFrom = { x: grab.x + 10, y: grab.y + 15 };
    const boxBefore = (await note.boundingBox())!;
    await dragNote(page, note, grabFrom);
    await expect
      .poll(async () => {
        const b = (await note.boundingBox())!;
        return Math.max(Math.abs(b.x - (boxBefore.x + DRAG.dx)), Math.abs(b.y - (boxBefore.y + DRAG.dy)));
      })
      .toBeLessThanOrEqual(1);
    const worldAfter = await worldPos(note);
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(DRAG.dx / HALF_ZOOM, 6);
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(DRAG.dy / HALF_ZOOM, 6);
    // sticky.no_pan: the board did not move.
    expect(await getCamera(page)).toEqual(cameraBefore);
    expectNear(await originMarkerCentre(page), markerBefore, 0);
    // After the drag the note is selected and the toolbar is back.
    await expect(note).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible();

    // Recolour.
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect(note).toHaveCSS('background-color', hexToRgb(STICKY_COLORS.green));
    await expect(note).toHaveAttribute('data-selected', 'true');
    expect(await worldPos(note)).toEqual(worldAfter);
    await expect(note).toContainText('Hello');

    // A duplicate made with the toolbar button, then deleted with the Delete key.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(notes(page)).toHaveCount(2);
    const duplicateId = await page.locator('[data-state="editing"]').getAttribute('data-id');
    const duplicate = page.locator(`[data-id="${duplicateId}"]`);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    await expect(duplicate).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    await expect(duplicate).toHaveCount(0);

    // The board ends with the recoloured, moved note.
    await expect(notes(page).first()).toHaveAttribute('data-color', 'green');
    await expect(notes(page).first()).toContainText('Hello');
    expect(await worldPos(notes(page).first())).toEqual(worldAfter);

    // Backspace while editing edits text, it does not delete the note.
    await notes(page).first().dblclick();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(notes(page)).toHaveCount(1);
    await expect(notes(page).first()).toContainText('Hell');
    await expect(notes(page).first()).not.toContainText('Hello');
  });
});

test('TC-32 at 200% a drag moves the note by half the screen distance and draws it above the note it overlaps', async ({
  page,
}) => {
  await openBoard(page);
  const a = await createByDoubleClick(page, DBLCLICK_AT, SHORT_PHRASE);
  await page.keyboard.press('Escape');
  // B is centred just right of A, so it covers A's right part (B is newer, so on top).
  const bAt = { x: DBLCLICK_AT.x + STICKY_SIZE_WORLD / 2 + 20, y: DBLCLICK_AT.y + 30 };
  const b = await createByDoubleClick(page, bAt, RETRO_ITEM);
  await page.keyboard.press('Escape');
  const overlapPoint = { x: DBLCLICK_AT.x + 60, y: DBLCLICK_AT.y };
  const topAt = (p: Point) =>
    page.evaluate(
      ({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-id]') as HTMLElement | null)?.dataset.id,
      p,
    );
  const idA = await a.getAttribute('data-id');
  const idB = await b.getAttribute('data-id');
  expect(await topAt(overlapPoint)).toBe(idB);

  // 200% zoom around A's centre.
  await zoomAround(page, DOUBLE_ZOOM, DBLCLICK_AT);
  const worldBefore = await worldPos(a);
  const aBox = (await a.boundingBox())!;
  const grab = { x: aBox.x + 30, y: aBox.y + aBox.height / 2 }; // A's uncovered left part
  expect(await topAt(grab)).toBe(idA);
  await dragNote(page, a, grab);
  await expect
    .poll(async () => {
      const box = (await a.boundingBox())!;
      return Math.max(Math.abs(box.x - (aBox.x + DRAG.dx)), Math.abs(box.y - (aBox.y + DRAG.dy)));
    })
    .toBeLessThanOrEqual(1);
  const worldAfter = await worldPos(a);
  expect(worldAfter.x - worldBefore.x).toBeCloseTo(DRAG.dx / DOUBLE_ZOOM, 6);
  expect(worldAfter.y - worldBefore.y).toBeCloseTo(DRAG.dy / DOUBLE_ZOOM, 6);

  // A is now drawn above B where they overlap.
  const aNow = (await a.boundingBox())!;
  const bNow = (await b.boundingBox())!;
  const overlap = {
    x: (Math.max(aNow.x, bNow.x) + Math.min(aNow.x + aNow.width, bNow.x + bNow.width)) / 2,
    y: (Math.max(aNow.y, bNow.y) + Math.min(aNow.y + aNow.height, bNow.y + bNow.height)) / 2,
  };
  expect(Math.min(aNow.x + aNow.width, bNow.x + bNow.width)).toBeGreaterThan(Math.max(aNow.x, bNow.x));
  expect(await topAt(overlap)).toBe(idA);
});

test('TC-33 text fits: one word at the maximum size, 1,000 characters clipped at the minimum with a fade', async ({
  page,
}) => {
  await openBoard(page);
  const note = await createByDoubleClick(page, DBLCLICK_AT, 'Onboarding');
  const text = note.getByTestId('sticky-text');
  await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
  await expect(note).not.toHaveClass(/sticky-fade/);

  // Paste the 1,000 character paragraph (insertText is a single input like a paste).
  await page.keyboard.insertText(LONG_PARAGRAPH);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toHaveValue(new RegExp(`^.{${STICKY_TEXT_MAX_CHARS}}$`, 's'));
  await expect(page.getByTestId('sticky-counter')).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  await expect(note).toHaveClass(/sticky-fade/);
  await page.keyboard.press('Escape');

  const fontPx = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fontPx).toBe(STICKY_FONT_MIN_PX);
  const clip = await text.evaluate((el) => ({
    overflow: getComputedStyle(el).overflowY,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(clip.overflow).toBe('hidden');
  expect(clip.scrollHeight).toBeGreaterThan(clip.clientHeight);
  // Nothing is drawn outside the note.
  const noteBox = (await note.boundingBox())!;
  const textBox = (await text.boundingBox())!;
  expect(textBox.y + textBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 0.5);
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(noteBox.x + noteBox.width + 0.5);
  const fade = await note.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(fade).not.toBe('none');

  // Medium text sits between the limits.
  await note.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(RETRO_ITEM);
  await page.keyboard.press('Escape');
  const medium = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(medium).toBeGreaterThan(STICKY_FONT_MIN_PX);
  expect(medium).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
  await expect(note).not.toHaveClass(/sticky-fade/);
});

test('TC-34 Sticky note button creates a visible note at the screen centre when panned far away', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
  const button = page.getByRole('button', { name: 'Sticky note' });
  await expect(button).toHaveAttribute('title', 'Sticky note – or double-click the board');
  await button.click();
  await expect(notes(page)).toHaveCount(1);
  const viewport = page.viewportSize()!;
  expectNear(await centreOf(notes(page).first()), { x: viewport.width / 2, y: viewport.height / 2 });
  await expect(notes(page).first()).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
  await page.keyboard.type(SHORT_PHRASE);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue(SHORT_PHRASE);
});
