// Story 2 e2e (Chromium): sticky note workflows TC-30 to TC-34.
// The app is served with --mode test, so window.__vidi6 test hooks are
// available for camera control and document assertions.

import { expect, test, type Page } from '@playwright/test';
import { PROSE_1000 } from '../fixtures/texts';
import type { Vidi6NoteInfo } from '../../src/client/testHooks';

async function notes(page: Page): Promise<Vidi6NoteInfo[]> {
  return page.evaluate(() => window.__vidi6!.getNotes());
}

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), cam);
  // Let React apply the camera before interacting.
  await page.waitForTimeout(100);
}

/** Camera that keeps world (0,0) at the centre of the 1280x800 viewport. */
function centeredCamera(zoom: number) {
  return { x: -(640 / zoom), y: -(400 / zoom), zoom };
}

const note = (page: Page) => page.getByTestId('sticky-note');

// Fresh app state per test; wait until React has mounted before any
// interaction (module transforms are pre-warmed by the global setup).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('board-root').waitFor();
});

test('TC-30: double-click creates a note centred on the click point, ready to type', async ({ page }) => {
  await page.mouse.dblclick(400, 300);

  const box = await note(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width / 2).toBeCloseTo(400, 0);
  expect(box!.y + box!.height / 2).toBeCloseTo(300, 0);

  // The editor is focused: typed characters go straight into the note.
  await page.keyboard.type('Hello');
  const list = await notes(page);
  expect(list).toHaveLength(1);
  expect(list[0].text).toBe('Hello');
});

test('TC-31: dragging at 50% zoom moves 1 world unit per 0.5 screen px; grabbed point stays under the pointer', async ({ page }) => {
  await setCamera(page, centeredCamera(0.5));

  // Create a note centred on the origin (= viewport centre at this camera).
  await page.mouse.dblclick(640, 400);
  await page.keyboard.press('Escape');
  const before = (await notes(page))[0];
  expect(before.x).toBe(-100);
  expect(before.y).toBe(-100);

  // Real drag of (100, 50) screen px from the note centre.
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(740, 450, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(50); // let the throttled final position flush

  const after = (await notes(page))[0];
  expect(after.x).toBe(before.x + 200); // 100 px / 0.5 zoom
  expect(after.y).toBe(before.y + 100); // 50 px / 0.5 zoom

  const box = await note(page).boundingBox();
  expect(box!.x + box!.width / 2).toBeCloseTo(740, 0); // grabbed point under pointer
  expect(box!.y + box!.height / 2).toBeCloseTo(450, 0);
});

test('TC-32: dragging at 200% zoom moves 1 world unit per 2 screen px; the dragged note comes to the front', async ({ page }) => {
  await setCamera(page, centeredCamera(2));

  // Note A centred on the origin; note B offset so both are visible but
  // overlapping (B on top, created last).
  await page.mouse.dblclick(640, 400);
  await page.keyboard.type('A');
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(860, 400);
  await page.keyboard.type('B');
  await page.keyboard.press('Escape');

  let list = await notes(page);
  const a = list.find((n) => n.text === 'A')!;
  const b = list.find((n) => n.text === 'B')!;
  expect(a.x).toBe(-100);
  expect(a.y).toBe(-100);
  expect(b.z).toBeGreaterThan(a.z); // B created last is on top

  // Grab note A in its exposed left part and drag (100, 50) screen px.
  await page.mouse.move(480, 300);
  await page.mouse.down();
  await page.mouse.move(580, 350, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(50);

  list = await notes(page);
  const aAfter = list.find((n) => n.text === 'A')!;
  const bAfter = list.find((n) => n.text === 'B')!;
  expect(aAfter.x).toBe(a.x + 50); // 100 px / 2 zoom
  expect(aAfter.y).toBe(a.y + 25); // 50 px / 2 zoom
  expect(aAfter.z).toBeGreaterThan(bAfter.z); // dragged note now above B
  expect(bAfter.x).toBe(b.x); // B untouched
  expect(bAfter.y).toBe(b.y);
});

test('TC-33: short text renders at the max font; long text shrinks to the minimum and clips with a fade', async ({ page }) => {
  // One word fits: the text renders at the maximum font size (24px).
  await page.mouse.dblclick(640, 400);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  const shortFont = await page.locator('.sticky-note__text').evaluate((el) => getComputedStyle(el).fontSize);
  expect(shortFont).toBe('24px');

  // Paste 1,000 characters: the font shrinks to the minimum (10px) and the
  // overflow is clipped with a fade at the bottom edge.
  await page.mouse.dblclick(640, 400);
  await page.getByTestId('sticky-editor').fill(PROSE_1000);
  await page.keyboard.press('Escape');

  const info = await page.evaluate(() => {
    const n = document.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    const t = n.querySelector<HTMLElement>('.sticky-note__text')!;
    return {
      fontSize: getComputedStyle(t).fontSize,
      scrollHeight: t.scrollHeight,
      clientHeight: t.clientHeight,
      overflowClass: n.classList.contains('sticky-note--overflow'),
      fade: Boolean(n.querySelector('[data-testid="sticky-fade"]')),
    };
  });
  expect(info.fontSize).toBe('10px');
  expect(info.scrollHeight).toBeGreaterThan(info.clientHeight);
  expect(info.overflowClass).toBe(true);
  expect(info.fade).toBe(true);

  // Nothing is written beyond the limit.
  const list = await notes(page);
  expect(list[0].text.length).toBe(1000);
});

test('TC-34: the Sticky note button always creates a note at the centre of the screen, even when panned far away', async ({ page }) => {
  await setCamera(page, { x: 5000, y: 5000, zoom: 1 }); // origin far off-screen

  await page.getByRole('button', { name: 'Sticky note' }).click();

  const box = await note(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width / 2).toBeCloseTo(640, 0);
  expect(box!.y + box!.height / 2).toBeCloseTo(400, 0);
  expect(box!.width).toBeCloseTo(200, 0); // full size at 100% zoom

  const list = await notes(page);
  expect(list).toHaveLength(1);
  expect(list[0].x).toBe(5000 + 640 - 100);
  expect(list[0].y).toBe(5000 + 400 - 100);
});
