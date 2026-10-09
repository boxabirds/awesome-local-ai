import { test, expect, type Page } from '@playwright/test';
import { gotoBoard, getCamera, setCamera, getNotes } from './helpers/board';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { PROSE_1000 } from '../fixtures/texts';

async function centerOfNoteId(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error('note has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragFromTo(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function keepCameraWithZoom(page: Page, zoom: number): Promise<void> {
  const cam = await getCamera(page);
  await setCamera(page, { x: cam.x, y: cam.y, zoom });
}

test('TC-30: double-click creates a note centred on the point and typing fills it', async ({
  page,
}) => {
  await gotoBoard(page);
  await page.mouse.dblclick(400, 300);
  await expect(page.getByTestId('sticky-textarea')).toBeVisible();
  await page.keyboard.type('Hello');

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  expect(notes[0].text).toBe('Hello');

  const center = await centerOfNoteId(page, notes[0].id);
  expect(Math.abs(center.x - 400)).toBeLessThanOrEqual(1);
  expect(Math.abs(center.y - 300)).toBeLessThanOrEqual(1);
});

test('TC-31: at 50% zoom a drag keeps the grabbed point under the pointer; recolour and delete', async ({
  page,
}) => {
  await gotoBoard(page);
  await keepCameraWithZoom(page, 0.5);

  await page.mouse.dblclick(500, 300);
  await page.keyboard.press('Escape');
  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  const before = notes[0];

  await dragFromTo(page, [500, 300], [600, 350]);

  const moved = (await getNotes(page))[0];
  // screen (100, 50) at zoom 0.5 = world (200, 100)
  expect(moved.x).toBeCloseTo(before.x + 200, 1);
  expect(moved.y).toBeCloseTo(before.y + 100, 1);
  const center = await centerOfNoteId(page, before.id);
  expect(Math.abs(center.x - 600)).toBeLessThanOrEqual(1);
  expect(Math.abs(center.y - 350)).toBeLessThanOrEqual(1);

  await page.getByLabel('Pink colour').click();
  expect((await getNotes(page))[0].color).toBe('pink');

  await page.keyboard.press('Delete');
  await expect.poll(() => getNotes(page)).toEqual([]);
});

test('TC-32: at 200% zoom a drag lands at half world distance and draws the dragged note on top', async ({
  page,
}) => {
  await gotoBoard(page);
  await keepCameraWithZoom(page, 2);
  const cam = await getCamera(page);
  // screen (400, 400) at zoom 2 maps to this world centre
  const targetWorld = { x: cam.x + 400 / 2, y: cam.y + 400 / 2 };

  // note B first (lower z-order), note A second via the toolbar button (screen centre)
  await page.mouse.dblclick(400, 400);
  await page.keyboard.press('Escape');
  await page.getByTestId('create-sticky').click();
  await page.keyboard.press('Escape');

  const notes = await getNotes(page);
  expect(notes).toHaveLength(2);
  const noteB = notes.find(
    (n) =>
      Math.abs(n.x + STICKY_SIZE_WORLD / 2 - targetWorld.x) < 1 &&
      Math.abs(n.y + STICKY_SIZE_WORLD / 2 - targetWorld.y) < 1,
  )!;

  await dragFromTo(page, [400, 400], [500, 450]);

  const after = await getNotes(page);
  expect(after).toHaveLength(2);
  const dragged = after.find((n) => n.id === noteB.id)!;
  // screen (100, 50) at zoom 2 = world (50, 25)
  expect(dragged.x).toBeCloseTo(noteB.x + 50, 1);
  expect(dragged.y).toBeCloseTo(noteB.y + 25, 1);

  // (650, 450) sits inside both notes after the drag; the dragged one must win
  const topId = await page.evaluate(() => {
    const el = document.elementFromPoint(650, 450);
    return el ? el.closest('[data-note-id]')?.getAttribute('data-note-id') ?? null : null;
  });
  expect(topId).toBe(noteB.id);
});

test('TC-33: font auto-fit shrinks long text, fades overflow, never escapes the note', async ({
  page,
}) => {
  await gotoBoard(page);
  await page.mouse.dblclick(640, 300);
  const editor = page.getByTestId('sticky-textarea');
  await expect(editor).toBeVisible();
  await page.keyboard.type('Word');
  const shortPx = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(shortPx).toBe(STICKY_FONT_MAX_PX);

  await editor.fill(PROSE_1000);
  await page.keyboard.press('Escape');

  const text = page.getByTestId('sticky-text');
  await expect(text).toBeVisible();
  const info = await text.evaluate((el) => {
    const note = el.closest('[data-note-id]');
    if (!(el instanceof HTMLElement) || !(note instanceof HTMLElement)) throw new Error('missing');
    return {
      fontPx: parseFloat(getComputedStyle(el).fontSize),
      overflowClass: el.classList.contains('sticky-overflow'),
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    };
  });
  expect(info.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(info.overflowClass).toBe(true);
  expect(info.scrollH).toBeGreaterThan(info.clientH);
  // clipping: nothing rendered outside the inner box
  const clip = await text.evaluate((el) => getComputedStyle(el).overflow);
  expect(clip).toBe('hidden');
});

test('TC-34: panned far away, the Sticky note button creates a note at the screen centre', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 450_000, y: -350_000, zoom: 1 });
  await page.getByTestId('create-sticky').click();

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  const center = await centerOfNoteId(page, notes[0].id);
  expect(Math.abs(center.x - 640)).toBeLessThanOrEqual(1);
  expect(Math.abs(center.y - 400)).toBeLessThanOrEqual(1);
});
