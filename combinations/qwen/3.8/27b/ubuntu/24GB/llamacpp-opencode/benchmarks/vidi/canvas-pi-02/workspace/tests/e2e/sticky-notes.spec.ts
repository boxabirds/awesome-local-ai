import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { EXACTLY_1000_CHARS } from '../fixtures/texts';
import {
  boardViewport,
  getNotes,
  getTheNote,
  setCamera,
  zoomLabel,
} from './helpers/board';

/**
 * Story 2 e2e: capture ideas on sticky notes and rearrange them (TC-30..34
 * plus the PRD regrouping/error scenarios).
 *
 * Camera math: world (wx, wy) renders at screen ((wx - cam.x) * zoom,
 * (wy - cam.y) * zoom). A note created centred on the viewport has its
 * top-left at (centre - 100, centre - 100) in world units.
 */

const HOME_CAMERA = { x: -640, y: -400, zoom: 1 };

const notes = (page: Page) => page.locator('.vidi6-sticky');
const textarea = (page: Page) => page.getByRole('textbox', { name: 'Sticky note text' });

test.beforeEach(async ({ page }) => {
  // Start every test at the same camera so all pixel math is stable.
  await page.goto('/');
  await setCamera(page, HOME_CAMERA);
});

test.describe('sticky.create', () => {
  test('E2E-01 (TC-34) the toolbar button creates a note visible at the screen centre, even when panned far away', async ({
    page,
  }) => {
    await expect(notes(page)).toHaveCount(0);
    // Pan far away from the origin; the button must still create at the
    // centre of the *visible* board.
    await setCamera(page, { x: -5000, y: -4000, zoom: 1 });

    await page.getByRole('button', { name: 'Sticky note' }).click();

    await expect(notes(page)).toHaveCount(1);
    // Centre of the 1280x800 viewport is world (-5000+640, -4000+400) =
    // (-4360, -3600) => top-left (-4460, -3700).
    const note = await getTheNote(page);
    expect(note.x).toBeCloseTo(-4460, 3);
    expect(note.y).toBeCloseTo(-3700, 3);
    // Visible at the screen centre.
    const box = await notes(page).first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width / 2).toBeCloseTo(640, 0);
    expect(box!.y + box!.height / 2).toBeCloseTo(400, 0);
    // Created in edit mode: the textarea is visible and focused.
    const ta = textarea(page);
    await expect(ta).toBeVisible();
    await expect(ta).toBeFocused();
    await expect(ta).toHaveValue('');
  });

  test('E2E-02 (TC-30) double-click on empty board creates a note at the clicked point', async ({
    page,
  }) => {
    await page.mouse.dblclick(400, 300);

    await expect(notes(page)).toHaveCount(1);
    // The note centre sits at the clicked screen point (±1px).
    const box = await notes(page).first().boundingBox();
    expect(box!.x + box!.width / 2).toBeCloseTo(400, 0);
    expect(box!.y + box!.height / 2).toBeCloseTo(300, 0);
    // ...and in world units the top-left is (-340, -200).
    const note = await getTheNote(page);
    expect(note.x).toBeCloseTo(-340, 3);
    expect(note.y).toBeCloseTo(-200, 3);
    // Created in edit mode; typing lands in the note.
    await expect(textarea(page)).toBeFocused();
    await page.keyboard.type('Hello');
    expect((await getTheNote(page)).text).toBe('Hello');
  });
});

test.describe('sticky.text', () => {
  test('E2E-03 typing updates the text; the counter appears within 50 chars of the limit', async ({
    page,
  }) => {
    await expect
      .poll(() => EXACTLY_1000_CHARS.length, { message: 'fixture must be exactly 1000 chars' })
      .toBe(1000);

    await page.getByRole('button', { name: 'Sticky note' }).click();
    const ta = textarea(page);

    // 80 chars: far from the limit, counter hidden.
    const medium = 'Idea number one and a tail that pushes this well past fifty characters in total.';
    expect(medium.length).toBe(80);
    await page.keyboard.type(medium);
    await expect(page.locator('.vidi6-sticky__counter')).toHaveCount(0);

    // 960 chars: within 50 of the limit, counter visible with the true count.
    await ta.fill(EXACTLY_1000_CHARS.slice(0, 960));
    await expect(page.locator('.vidi6-sticky__counter')).toHaveText('960/1000');

    // The full 1000-char boundary text is accepted (soft limit, no truncation).
    await ta.fill(EXACTLY_1000_CHARS);
    await expect(ta).toHaveValue(EXACTLY_1000_CHARS);
    await expect(page.locator('.vidi6-sticky__counter')).toHaveText('1000/1000');
    expect((await getTheNote(page)).text).toBe(EXACTLY_1000_CHARS);
  });
});

test.describe('sticky.move', () => {
  test('E2E-04 (TC-31) dragging at 50% zoom moves by twice the screen pixels and never pans', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    await expect(textarea(page)).toHaveCount(0);
    // Zoom 50% with the note centre at the viewport centre:
    // cam = centre - viewport/2/zoom = (0 - 1280, 0 - 800).
    await setCamera(page, { x: -1280, y: -800, zoom: 0.5 });

    const worldBefore = await page.evaluate(() => {
      const el = document.querySelector('.vidi6-world') as HTMLElement;
      return el.style.transform;
    });

    // Drag (100, 50) screen px at 50% => world (+200, +100).
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(740, 450, { steps: 12 });
    await page.mouse.up();

    const note = await getTheNote(page);
    expect(note.x).toBeCloseTo(-100 + 200, 1);
    expect(note.y).toBeCloseTo(-100 + 100, 1);
    // The grabbed point (note centre) stays under the pointer (±1px).
    const box = await notes(page).first().boundingBox();
    expect(box!.x + box!.width / 2).toBeCloseTo(740, 0);
    expect(box!.y + box!.height / 2).toBeCloseTo(450, 0);
    // The board camera did not move (no pan while dragging a note).
    const worldAfter = await page.evaluate(() => {
      const el = document.querySelector('.vidi6-world') as HTMLElement;
      return el.style.transform;
    });
    expect(worldAfter).toBe(worldBefore);
    await expect(zoomLabel(page)).toHaveText('50%');
  });

  test('E2E-05 (TC-32) dragging at 200% zoom moves by half the screen pixels and draws above the overlapped note', async ({
    page,
  }) => {
    // A and B overlap at the centre (B on top, created later).
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    let all = await getNotes(page);
    expect(all).toHaveLength(2);
    // Move B (top) aside by (120, 0) at 100% so part of A is free to grab.
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(760, 400, { steps: 8 });
    await page.mouse.up();
    all = await getNotes(page);
    const near = (n: { x: number }, target: number): boolean => Math.abs(n.x - target) < 1;
    const a = all.find((n) => near(n, -100))!; // A stayed put
    const b = all.find((n) => near(n, 20))!; // B top-left moved to (20, -100)
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();

    // Zoom 200% with the viewport centre at world (0,0): cam = (-320, -200).
    // A centre (0,0) => screen (640,400); B centre (120,0) => screen (880,400).
    // A is free to grab left of B's left edge (screen 780).
    await setCamera(page, { x: -320, y: -200, zoom: 2 });

    // Drag A (the *bottom* note) by (100, 50) screen px at 200%
    // => world (+50, +25) => top-left (-50, -75).
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(700, 450, { steps: 12 });
    await page.mouse.up();

    all = await getNotes(page);
    const aAfter = all.find((n) => n.id === a.id)!;
    const bAfter = all.find((n) => n.id === b.id)!;
    expect(aAfter.x).toBeCloseTo(-50, 1);
    expect(aAfter.y).toBeCloseTo(-75, 1);
    // A came to the front: above the note it overlaps, and last in DOM order.
    expect(aAfter.z).toBeGreaterThan(bAfter.z);
    const rendered = await page
      .locator('.vidi6-sticky')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-note-id')));
    expect(rendered[rendered.length - 1]).toBe(aAfter.id);
    // No accidental zoom.
    await expect(zoomLabel(page)).toHaveText('200%');
  });
});

test.describe('sticky.style', () => {
  test('E2E-06 clicking a swatch changes the note colour (visible, not just data)', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    // Select the note (a press on it).
    await page.mouse.click(640, 400);

    await page.getByRole('button', { name: 'Blue colour' }).click();

    const note = await getTheNote(page);
    expect(note.color).toBe('blue');
    // blue = #90CAF9 (the shared palette).
    await expect(notes(page).first()).toHaveCSS('background-color', 'rgb(144, 202, 249)');
  });
});

test.describe('sticky.delete', () => {
  test('E2E-07 the bin removes the selected note from board and doc', async ({ page }) => {
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    await page.mouse.click(640, 400); // select
    await expect(page.getByRole('toolbar', { name: 'Note options' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete note' }).click();

    await expect(notes(page)).toHaveCount(0);
    await expect.poll(() => getNotes(page).then((n) => n.length)).toBe(0);
  });
});

test.describe('sticky.fit', () => {
  test('E2E-08 (TC-33) one word renders at 24px; 1,000 pasted chars shrink to 10px with the fade', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Sticky note' }).click();
    const ta = textarea(page);

    // One word: fits at the maximum font size (24px).
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    let textEl = page.locator('.vidi6-sticky__text');
    await expect(textEl).toHaveCSS('font-size', '24px');
    await expect(page.locator('.vidi6-sticky__fade')).toHaveCount(0);

    // Paste the 1,000-char boundary text: shrinks to the minimum (10px),
    // the bottom fade appears, and nothing is truncated.
    await page.mouse.dblclick(640, 400); // edit again
    await ta.fill(EXACTLY_1000_CHARS);
    await expect(ta).toHaveValue(EXACTLY_1000_CHARS);
    await page.keyboard.press('Escape');

    textEl = page.locator('.vidi6-sticky__text');
    await expect(textEl).toHaveCSS('font-size', '10px');
    await expect(page.locator('.vidi6-sticky__fade')).toBeVisible();
    const shown = await textEl.textContent();
    expect(shown?.length).toBe(1000);
  });
});

test.describe('sticky.stack', () => {
  test('E2E-09 dragging raises the note; a delete mid-drag stays silent and re-creates nothing', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err as Error));

    // A at the centre (z 1); B created on top of it (z 2), then moved aside
    // by (120, 0) so part of A is free to grab.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(760, 400, { steps: 8 });
    await page.mouse.up();

    let all = await getNotes(page);
    const noteA = all.find((n) => Math.abs(n.x + 100) < 1)!;
    const noteB = all.find((n) => Math.abs(n.x - 20) < 1)!;
    expect(noteB.z).toBeGreaterThan(noteA.z);

    // Drag A (the bottom note) by (50, 0): the grabbed note comes to the
    // front, above the note it overlaps.
    await page.mouse.move(590, 400);
    await page.mouse.down();
    await page.mouse.move(640, 400, { steps: 8 });
    await page.mouse.up();
    all = await getNotes(page);
    const aAfter = all.find((n) => n.id === noteA.id)!;
    const bAfter = all.find((n) => n.id === noteB.id)!;
    expect(aAfter.z).toBeGreaterThan(bAfter.z);

    // Delete mid-drag: start dragging B, move past the threshold, then delete
    // the selected note while the pointer is still down. The drag ends
    // silently, nothing is re-created, and the board stays interactive.
    // A (now on top) spans screen x 590..790; grab B in its free part
    // (x 790..860), e.g. at (820, 400).
    await page.mouse.move(820, 400);
    await page.mouse.down();
    await page.mouse.move(860, 420, { steps: 6 });
    await page.keyboard.press('Delete');
    await page.mouse.move(880, 440, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => getNotes(page).then((n) => n.length)).toBe(1);
    const survivor = await getTheNote(page);
    expect(survivor.id).toBe(noteA.id);
    expect(pageErrors).toEqual([]);
    await expect(boardViewport(page)).toBeVisible();
  });
});
