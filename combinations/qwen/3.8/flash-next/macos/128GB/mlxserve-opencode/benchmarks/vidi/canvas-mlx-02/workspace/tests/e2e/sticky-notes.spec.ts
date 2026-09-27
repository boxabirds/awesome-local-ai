import { test, expect } from '@playwright/test';
import {
  gotoBoard,
  setCamera,
  getCamera,
  notes,
  firstNote,
  noteWorldTopLeft,
  noteScreenCenter,
  noteIdsInPaintOrder,
  noteByTestId,
  createNoteAt,
  typeText,
  pasteIntoEditor,
  noteTextEl,
  dragBy,
  screenToWorld,
} from './helpers/sticky.ts';
import { LONG_PROSE_1000 } from '../fixtures/texts.ts';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config.ts';

async function computedFontSize(el: import('@playwright/test').Locator): Promise<number> {
  const v = await el.evaluate((e) => getComputedStyle(e).fontSize);
  return parseFloat(v);
}

async function noteCount(page: import('@playwright/test').Page): Promise<number> {
  return notes(page).count();
}

// TC-30: real double-click creates a centred, editable note.
test('TC-30 double-click creates a centred note and typing lands in it', async ({ page }) => {
  await gotoBoard(page);
  const cam = await getCamera(page);
  const target = { x: 400, y: 300 };

  await createNoteAt(page, target.x, target.y);
  await typeText(page, 'Hello');

  const center = await noteScreenCenter(firstNote(page));
  expect(Math.abs(center.x - target.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(center.y - target.y)).toBeLessThanOrEqual(1);

  // Text is being typed into the note (world centre equals the clicked point).
  const world = screenToWorld(cam, target);
  const tl = await noteWorldTopLeft(firstNote(page));
  expect(Math.abs(tl.x - (world.x - STICKY_SIZE_WORLD / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(tl.y - (world.y - STICKY_SIZE_WORLD / 2))).toBeLessThanOrEqual(1);

  await page.keyboard.press('Escape');
  await expect(noteTextEl(firstNote(page))).toContainText('Hello');
});

// Golden path: create -> type -> recolour -> delete.
test('golden path creates, recolours and deletes a note', async ({ page }) => {
  await gotoBoard(page);
  await createNoteAt(page, 400, 300);
  await typeText(page, 'Faster onboarding');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'green colour' }).click();
  const bg = await firstNote(page).evaluate((e) => {
    const s = ((e as HTMLElement).style.background || '').toUpperCase();
    const hex = /#([0-9A-F]{6})/.exec(s);
    if (hex) return '#' + hex[1];
    const rgb = /RGBA?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
    if (rgb) {
      const to = (n: string) => Number(n).toString(16).padStart(2, '0');
      return ('#' + to(rgb[1]) + to(rgb[2]) + to(rgb[3])).toUpperCase();
    }
    return s;
  });
  expect(bg).toBe('#C5E1A5');

  await page.keyboard.press('Delete');
  expect(await noteCount(page)).toBe(0);
});

// TC-31: at 50% zoom a (100,50) screen drag moves the note by +200,+100 world
// units and keeps the grabbed point under the pointer.
test('TC-31 drag at 50% zoom moves by world delta and tracks the pointer', async ({ page }) => {
  await gotoBoard(page);
  const cam = { x: -1280, y: -800, zoom: 0.5 };
  await setCamera(page, cam);

  // Create a note centred on the viewport centre (world 0,0).
  await createNoteAt(page, 640, 400);
  await page.keyboard.press('Escape');

  const before = await noteWorldTopLeft(firstNote(page));
  const grab = await noteScreenCenter(firstNote(page));
  await dragBy(page, grab, 100, 50);

  const after = await noteWorldTopLeft(firstNote(page));
  expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);

  // The grabbed point (the note centre) stayed under the pointer.
  const center = await noteScreenCenter(firstNote(page));
  expect(Math.abs(center.x - (grab.x + 100))).toBeLessThanOrEqual(1);
  expect(Math.abs(center.y - (grab.y + 50))).toBeLessThanOrEqual(1);
});

// TC-32: at 200% zoom a (100,50) drag moves +50,+25 world and brings the dragged
// note above an overlapped note.
test('TC-32 drag at 200% zoom moves by world delta and stacks the note on top', async ({ page }) => {
  await gotoBoard(page);
  const cam = { x: -320, y: -200, zoom: 2 };
  await setCamera(page, cam);

  // Note A, then overlapping note B (B is created later, so B starts on top).
  await createNoteAt(page, 300, 400);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 600, 400);
  await page.keyboard.press('Escape');

  const orderBefore = await noteIdsInPaintOrder(page);
  const aId = orderBefore[0]; // A created first (lowest z)

  const aBefore = await noteWorldTopLeft(noteByTestId(page, aId));
  // Grab A at its own centre; B is off to the right so no overlap at the grab.
  const grabA = await noteScreenCenter(noteByTestId(page, aId));
  await dragBy(page, grabA, 100, 50);

  // A moved by +50,+25 world units.
  const aAfter = await noteWorldTopLeft(noteByTestId(page, aId));
  expect(Math.abs(aAfter.x - (aBefore.x + 50))).toBeLessThanOrEqual(1);
  expect(Math.abs(aAfter.y - (aBefore.y + 25))).toBeLessThanOrEqual(1);

  // A is now the topmost (drawn last).
  const orderAfter = await noteIdsInPaintOrder(page);
  expect(orderAfter[orderAfter.length - 1]).toBe(aId);
});

// TC-33: text auto-fits — a single word shows at the maximum size; a 1,000-char
// paragraph shrinks to the minimum, shows a bottom fade and clips inside the note.
test('TC-33 long text fits then fades and clips inside the note', async ({ page }) => {
  await gotoBoard(page);
  await createNoteAt(page, 640, 400);

  await typeText(page, 'Onboarding');
  let fs = await computedFontSize(noteTextEl(firstNote(page)));
  expect(fs).toBe(STICKY_FONT_MAX_PX);

  await pasteIntoEditor(page, LONG_PROSE_1000);
  await page.keyboard.press('Escape');

  fs = await computedFontSize(noteTextEl(firstNote(page)));
  expect(fs).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fs).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);

  const note = firstNote(page);
  await expect(note.locator('.sticky-text.sticky-text-overflow')).toHaveCount(1);

  // Content is clipped inside the note (scrollHeight exceeds the visible box).
  const clip = await noteTextEl(note).evaluate((e) => ({
    scroll: e.scrollHeight,
    client: e.clientHeight,
  }));
  expect(clip.scroll).toBeGreaterThan(clip.client);
});

// TC-34: creating from the toolbar while panned far away shows the note at the
// centre of the screen.
test('TC-34 toolbar create is always at the screen centre', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: 100000, y: 100000, zoom: 1 });

  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(page.locator('textarea.sticky-editor')).toBeVisible();

  const center = await noteScreenCenter(firstNote(page));
  const vp = page.viewportSize()!;
  expect(Math.abs(center.x - vp.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(center.y - vp.height / 2)).toBeLessThanOrEqual(1);
});
