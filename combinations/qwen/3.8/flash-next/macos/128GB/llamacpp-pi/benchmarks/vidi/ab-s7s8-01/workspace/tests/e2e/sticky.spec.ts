import { test, expect } from '@playwright/test';
import {
  openBoard,
  setCamera,
  snapshot,
  seedSticky,
  stickyByld,
  stickyCenter,
  mouseDrag,
} from './helpers/board';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../src/shared/config';
import { LONG_PROSE } from '../fixtures/texts';

// Uses the test-only window.__vidi6 hook (present in the --mode test build) to
// seed notes and read the model, and drives interaction with real Playwright
// input. `seedSticky(x, y)` places the note centred on world point (x, y).

async function stickyById(page: import('@playwright/test').Page, id: string) {
  return (await snapshot(page)).find((s) => s.id === id)!;
}

async function noteFontSize(page: import('@playwright/test').Page, id: string): Promise<number> {
  return page.evaluate((nid) => {
    const el = document.querySelector(`[data-note-id="${nid}"]`) as HTMLElement | null;
    return el ? parseFloat(getComputedStyle(el).fontSize) : -1;
  }, id);
}

test('TC-30 dblclick an empty point creates a note centred there', async ({ page }) => {
  await openBoard(page);
  await page.mouse.dblclick(400, 300);
  await expect.poll(() => snapshot(page).then((s) => s.length)).toBe(1);

  const snap = await snapshot(page);
  // The created note is centred on the double-click point (±1.5px).
  const c = await stickyCenter(page, snap[0].id);
  expect(Math.abs(c.x - 400)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(c.y - 300)).toBeLessThanOrEqual(1.5);
});

test('TC-30b type "Hello" into a dblclick-created note (no duplicate note)', async ({ page }) => {
  await openBoard(page);
  await page.mouse.dblclick(400, 300);
  const ta = page.getByTestId('sticky-textarea');
  await expect(ta).toBeVisible();
  await ta.fill('Hello');
  await ta.press('Escape');
  // Exactly one note exists (double-click did not create + edit).
  expect((await snapshot(page)).length).toBe(1);
  await expect
    .poll(() => snapshot(page).then((s) => s.find((n) => n.text === 'Hello') != null))
    .toBe(true);
});

test('TC-30c dblclick an existing note edits it and creates no new note', async ({ page }) => {
  await openBoard(page);
  // Create one note by double-clicking an empty point.
  await page.mouse.dblclick(400, 300);
  await expect.poll(() => snapshot(page).then((s) => s.length)).toBe(1);
  await page.keyboard.press('Escape'); // leave edit mode

  const snap = await snapshot(page);
  const c = await stickyCenter(page, snap[0].id);
  await page.mouse.dblclick(c.x, c.y);

  // Still exactly one note, and the existing one is now being edited.
  await expect(page.getByTestId('sticky-textarea')).toBeVisible();
  expect((await snapshot(page)).length).toBe(1);
});

test('TC-31 drag at 50% zoom keeps the grabbed point under the cursor', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: -640, y: -400, zoom: 0.5 });
  const id = await seedSticky(page, 0, 0);
  const before = await stickyById(page, id);
  const c = await stickyCenter(page, id);

  await mouseDrag(page, c.x, c.y, 100, 50);

  const after = await stickyById(page, id);
  // 100/50 CSS px at zoom 0.5 = 200/100 world units.
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(100, 0);
});

test('TC-32 drag at 200% zoom: world delta is halved; note drawn above', async ({ page }) => {
  await openBoard(page);
  // Centre world (0,0) on the viewport at zoom 2 (viewport 1280x800).
  await setCamera(page, { x: -320, y: -200, zoom: 2 });
  // Seed A on the left, then B to its right so they overlap and B is on top.
  const a = await seedSticky(page, -40, 0);
  const b = await seedSticky(page, 40, 0);
  await expect.poll(() => snapshot(page).then((s) => s.length)).toBe(2);

  const before = await stickyById(page, a);
  // Grab A at its exposed left edge (B is to the right and would swallow a
  // centre grab), then drag by 200/100 CSS px.
  const box = (await stickyByld(page, a).boundingBox())!;
  const sx = box.x + 10;
  const sy = box.y + box.height / 2;
  await mouseDrag(page, sx, sy, 200, 100);
  const after = await stickyById(page, a);

  // 200/100 CSS px at zoom 2 = 100/50 world units.
  expect(after.x - before.x).toBeCloseTo(100, 0);
  expect(after.y - before.y).toBeCloseTo(50, 0);

  // The dragged note is raised above the other one.
  const snap = await snapshot(page);
  expect(snap.findIndex((n) => n.id === a)).toBeGreaterThan(snap.findIndex((n) => n.id === b));
});

test('TC-33 long text shrinks the font and shows the overflow fade', async ({ page }) => {
  await openBoard(page);
  const id = await seedSticky(page, 0, 0);
  const c = await stickyCenter(page, id);

  await page.mouse.dblclick(c.x, c.y);
  const ta = page.getByTestId('sticky-textarea');
  await expect(ta).toBeVisible();
  await ta.fill(LONG_PROSE);
  await ta.press('Escape');

  await expect(page.getByTestId('sticky-fade')).toBeVisible();
  const size = await noteFontSize(page, id);
  expect(size).toBeLessThan(STICKY_FONT_MAX_PX);
  expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
});

test('TC-34 create at the centre works when panned far away', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: -123456, y: 98765, zoom: 1.5 });
  await page.getByRole('button', { name: 'Sticky note' }).click();

  await expect.poll(() => snapshot(page).then((s) => s.length)).toBe(1);
  const vp = page.viewportSize()!;
  const snap = await snapshot(page);
  const c = await stickyCenter(page, snap[0].id);
  expect(Math.abs(c.x - vp.width / 2)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(c.y - vp.height / 2)).toBeLessThanOrEqual(1.5);
});

test('TC-34b recolour then delete via the note toolbar (real pointer input)', async ({ page }) => {
  await openBoard(page);
  const id = await seedSticky(page, 100, -50);
  const c = await stickyCenter(page, id);

  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId('note-toolbar')).toBeVisible();

  await page.getByRole('button', { name: 'Pink colour' }).click();
  await expect
    .poll(() => snapshot(page).then((s) => s.find((n) => n.id === id)!.color))
    .toBe('pink');

  await page.getByTestId('note-delete').click();
  await expect(stickyByld(page, id)).toHaveCount(0);
});
