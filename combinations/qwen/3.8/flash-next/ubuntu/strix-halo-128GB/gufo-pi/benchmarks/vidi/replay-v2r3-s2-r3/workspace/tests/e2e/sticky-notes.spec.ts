import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  getAppNotes,
  waitForNoteCount,
  noteBox,
  centre,
  dragBy,
  setCamera,
} from './helpers/board';
import {
  STICKY_SIZE_WORLD,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_TEXT_1000 } from '../fixtures/texts';

const VIEWPORT = { width: 1280, height: 800 };

async function openBoard(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="origin-marker"]');
}

/** Double-click empty space and return the new note's id. */
async function createNote(page: Page, x: number, y: number) {
  const before = await getAppNotes(page);
  await page.mouse.dblclick(x, y);
  const after = await waitForNoteCount(page, before.length + 1);
  return after[after.length - 1].id;
}

async function noteText(page: Page, id: string): Promise<string> {
  return page.evaluate((noteId) => {
    const notes = window.__vidi6?.getNotes() ?? [];
    return notes.find((n) => n.id === noteId)?.text ?? '';
  }, id);
}

async function activeTagName(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? '');
}

test.describe('Workflow: brainstorm golden path', () => {
  test('TC-30 to TC-32 plus colour and delete', async ({ page }) => {
    await openBoard(page);
    expect(await getAppNotes(page)).toHaveLength(0);

    // --- TC-30: create by double-click and type straight away
    const id = await createNote(page, 400, 300);
    const createdBox = await noteBox(page, id);
    const createdCentre = centre(createdBox);
    expect(Math.abs(createdCentre.x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(createdCentre.y - 300)).toBeLessThanOrEqual(1);
    expect(createdBox.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(createdBox.height).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(await activeTagName(page)).toBe('TEXTAREA');

    await page.keyboard.type('Hello');
    await expect.poll(() => noteText(page, id)).toBe('Hello');

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-text"]')).toHaveText('Hello');

    // --- TC-31: drag at 50% zoom keeps the grabbed point under the pointer
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    await page.waitForTimeout(50);
    const worldBefore = (await getAppNotes(page)).find((n) => n.id === id)!;
    const boxBefore = await noteBox(page, id);
    const grab = centre(boxBefore);

    await dragBy(page, grab, 100, 50);

    const boxAfter = await noteBox(page, id);
    // Screen: the note followed the pointer
    expect(Math.abs(boxAfter.x - (boxBefore.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y - (boxBefore.y + 50))).toBeLessThanOrEqual(1);
    // The grabbed point of the note is still under the pointer
    const grabAfter = { x: boxAfter.x + (grab.x - boxBefore.x), y: boxAfter.y + (grab.y - boxBefore.y) };
    expect(Math.abs(grabAfter.x - (grab.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(grabAfter.y - (grab.y + 50))).toBeLessThanOrEqual(1);
    // World: screen delta divided by zoom
    const worldAfter = (await getAppNotes(page)).find((n) => n.id === id)!;
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(100 / 0.5, 0);
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(50 / 0.5, 0);
    expect(worldAfter.z).toBe(worldBefore.z); // already the topmost note

    // --- colour: the pink swatch recolours without touching anything else
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    await page.getByRole('button', { name: 'Pink colour' }).click();
    await expect
      .poll(async () => (await getAppNotes(page)).find((n) => n.id === id)?.color)
      .toBe('pink');
    const recoloured = (await getAppNotes(page)).find((n) => n.id === id)!;
    expect(recoloured.x).toBe(worldAfter.x);
    expect(recoloured.y).toBe(worldAfter.y);
    expect(recoloured.text).toBe('Hello');
    expect(recoloured.z).toBe(worldAfter.z);
    expect(await noteBox(page, id)).toMatchObject({ x: boxAfter.x, y: boxAfter.y });

    // --- delete: the selected note goes away and the board is empty again
    await page.keyboard.press('Delete');
    await waitForNoteCount(page, 0);
    expect(await page.locator('[data-note-id]').count()).toBe(0);
    expect(await page.getByTestId('note-toolbar').count()).toBe(0);
  });
});

test.describe('Drag at 200% zoom and stacking', () => {
  test('TC-32: world delta is half the screen delta and the dragged note comes to the front', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    await page.waitForTimeout(50);

    // Two notes overlapping: B is created second, so it is on top
    const first = await createNote(page, 300, 300);
    await page.keyboard.press('Escape');
    const second = await createNote(page, 500, 500);
    await page.keyboard.press('Escape');

    const notes = await getAppNotes(page);
    expect(notes.map((n) => n.id)).toEqual([first, second]);

    // A point where the two notes overlap: the newer note is on top to begin with
    const overlap = { x: 450, y: 420 };
    expect(await ownerIdAt(page, overlap)).toBe(second);

    // Grab the first note somewhere it is not covered by the second one
    const firstBox = await noteBox(page, first);
    const grab = { x: firstBox.x + 30, y: firstBox.y + 30 };
    await dragBy(page, grab, 100, 50);

    const after = await getAppNotes(page);
    const moved = after.find((n) => n.id === first)!;
    const before = notes.find((n) => n.id === first)!;
    expect(moved.x - before.x).toBeCloseTo(100 / 2, 0);
    expect(moved.y - before.y).toBeCloseTo(50 / 2, 0);

    // Stacking: the dragged note is now rendered last and wins hit-testing
    expect(after.map((n) => n.id)).toEqual([second, first]);
    expect(await ownerIdAt(page, overlap)).toBe(first);
  });
});

/** The note that a screen point hits (topmost), or null. */
function ownerIdAt(page: Page, point: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.closest('[data-note-id]')?.getAttribute('data-note-id') ?? null;
  }, point);
}

test.describe('Long text', () => {
  test('TC-33: one word uses the maximum font size, 1,000 characters shrink and fade', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNote(page, 400, 400);

    await page.keyboard.type('Done');
    await expect.poll(() => noteText(page, id)).toBe('Done');
    await page.keyboard.press('Escape');

    const text = page.locator(`[data-note-id="${id}"] [data-testid="sticky-text"]`);
    await expect
      .poll(() => text.evaluate((el) => getComputedStyle(el).fontSize))
      .toBe(`${STICKY_FONT_MAX_PX}px`);
    await expect(page.locator(`[data-note-id="${id}"] [data-testid="sticky-fade"]`)).toHaveCount(0);

    // Long paste (insertText mirrors a paste: one input event)
    await page.mouse.dblclick(400, 400);
    await expect(activeTagName(page)).resolves.toBe('TEXTAREA');
    await page.keyboard.insertText(LONG_TEXT_1000);
    await expect
      .poll(async () => (await noteText(page, id)).length)
      .toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
    await page.keyboard.press('Escape');

    const measured = await text.evaluate((el) => ({
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(measured.fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(measured.fontSize).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    expect(measured.scrollHeight).toBeGreaterThan(measured.clientHeight);

    // The overflow fade is present and inside the note
    const fade = page.locator(`[data-note-id="${id}"] [data-testid="sticky-fade"]`);
    await expect(fade).toHaveCount(1);
    await expect(fade).toHaveClass(/sticky-text-fade/);
    await expect(text).toHaveClass(/sticky-text-overflow/);
    const fadeBox = await fade.boundingBox();
    const box = await noteBox(page, id);
    expect(fadeBox).not.toBeNull();
    if (!fadeBox) throw new Error('fade missing');
    expect(fadeBox.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(fadeBox.x + fadeBox.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(fadeBox.y + fadeBox.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    // Nothing grew outside the note
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(box.height).toBeCloseTo(STICKY_SIZE_WORLD, 1);

    // Fitting is in world units, so zooming does not re-shrink the text
    const fontAt100 = measured.fontSize;
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    await page.waitForTimeout(50);
    const at200 = await text.evaluate((el) => ({
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      box: (el.closest('[data-note-id]') as HTMLElement).getBoundingClientRect().width,
    }));
    expect(at200.fontSize).toBeCloseTo(fontAt100, 3);
    expect(at200.box).toBeCloseTo(STICKY_SIZE_WORLD * 2, 1);
    await expect(fade).toHaveCount(1);
  });
});

test.describe('Create while panned far away', () => {
  test('TC-34: the toolbar button always creates a note in the middle of the screen', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 120000, y: -84000, zoom: 1 });
    await page.waitForTimeout(50);

    await page.getByRole('button', { name: 'Sticky note' }).click();
    const notes = await waitForNoteCount(page, 1);
    const id = notes[0].id;

    const box = await noteBox(page, id);
    const noteCentre = centre(box);
    expect(Math.abs(noteCentre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(noteCentre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(1);
    expect(notes[0].color).toBe('yellow');
    expect(await activeTagName(page)).toBe('TEXTAREA');
  });
});
