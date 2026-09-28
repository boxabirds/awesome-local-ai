// E2E tests for story 2 (sticky notes): TC-30 to TC-34, TC-39.
// Runs against the `dev:test` server (Vite --mode test), which exposes the
// window.__vidi6 seeding hooks.

import { expect, test } from '@playwright/test';
import { openBoard, setCamera } from './helpers/board';

interface StickyInfo {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

async function getNotes(page: import('@playwright/test').Page): Promise<StickyInfo[]> {
  return page.evaluate(() => window.__vidi6?.getStickyNotes() ?? []);
}

async function createNoteAt(page: import('@playwright/test').Page, x: number, y: number, color?: string): Promise<string> {
  const id = await page.evaluate(
    ([px, py, c]) => window.__vidi6?.createSticky(px, py, c) ?? null,
    [x, y, color] as [number, number, string?],
  );
  if (id === null) throw new Error('seed hook unavailable');
  await page.locator('[data-testid="sticky-note"][data-id="' + id + '"]').waitFor();
  return id;
}

/** Drags from (x1,y1) to (x2,y2) in screen space (10 intermediate steps). */
async function drag(page: import('@playwright/test').Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
}

const CENTER = { x: 640, y: 400 }; // 1280x800 viewport centre (playwright.config)

test('TC-30: double-click empty board creates a note centred on the click point, in editing', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  await page.mouse.dblclick(CENTER.x, CENTER.y);

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  // Centred on the clicked world point (1:1 at zoom 1, camera origin).
  expect(notes[0].x + 100).toBeCloseTo(CENTER.x, 1);
  expect(notes[0].y + 100).toBeCloseTo(CENTER.y, 1);
  // Immediately editable: the editor is focused.
  const input = page.getByTestId('sticky-editor-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
});

test('TC-31: the toolbar Sticky note button creates one note centred on the viewport, in editing', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  await page.getByRole('button', { name: 'Sticky note' }).click();

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  expect(notes[0].x + 100).toBeCloseTo(CENTER.x, 1);
  expect(notes[0].y + 100).toBeCloseTo(CENTER.y, 1);
  await expect(page.getByTestId('sticky-editor-input')).toBeFocused();
});

test('TC-32: dragging a note 200 screen px at zoom 1 moves it exactly 200 world units', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  await createNoteAt(page, 300, 400); // note centre at world (300,400)

  await drag(page, 300, 400, 500, 400);

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  expect(notes[0].x + 100).toBeCloseTo(500, 0.5);
  expect(notes[0].y + 100).toBeCloseTo(400, 0.5);
});

test('TC-33: dragging at zoom 50% divides the screen delta by 0.5', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 0.5);
  await createNoteAt(page, 200, 150); // world centre (200,150) → screen (100,75) at zoom 0.5

  // +100 screen px = +200 world px at 50% zoom.
  await drag(page, 100, 75, 200, 75);

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  expect(notes[0].x + 100).toBeCloseTo(400, 0.5);
  expect(notes[0].y + 100).toBeCloseTo(150, 0.5);
});

test('TC-34: a note dragged once comes to the front; a second drag does not change the z-order', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  const a = await createNoteAt(page, 300, 400);
  const b = await createNoteAt(page, 500, 400);

  const z = async (id: string): Promise<number> => (await getNotes(page)).find((n) => n.id === id)!.z;
  const zA0 = await z(a);
  const zB = await z(b);
  expect(zA0).toBeLessThan(zB); // b was created later: on top

  // First drag of A: A comes to the front (z increases).
  await drag(page, 300, 400, 310, 400);
  const zA1 = await z(a);
  expect(zA1).toBeGreaterThan(zB);

  // Second drag of A: already at the front → no z change.
  await drag(page, 310, 400, 320, 400);
  expect(await z(a)).toBe(zA1);
  expect(await z(b)).toBe(zB);
});

test('TC-39: double-click at the minimum zoom creates a note at the correct world point', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  // Drive the zoom to its floor (0.1) with the zoom-out control. From 100%,
  // exactly 11 steps of ×1/1.25 (clamped at the floor) reach 10%; the button
  // then disables.
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  for (let i = 0; i < 11; i++) await zoomOut.click();
  await expect(page.getByTestId('zoom-label')).toHaveText('10%');

  // Zoom steps are anchored on the viewport centre, so the screen centre
  // keeps mapping to the same world point (640,400) at any zoom.
  await page.mouse.dblclick(CENTER.x, CENTER.y);

  const notes = await getNotes(page);
  expect(notes).toHaveLength(1);
  expect(notes[0].x + 100).toBeCloseTo(640, 1);
  expect(notes[0].y + 100).toBeCloseTo(400, 1);
});
