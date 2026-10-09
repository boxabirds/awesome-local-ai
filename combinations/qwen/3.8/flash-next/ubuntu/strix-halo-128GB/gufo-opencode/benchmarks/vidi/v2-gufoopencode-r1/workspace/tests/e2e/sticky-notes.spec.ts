import { expect, test, type Page } from '@playwright/test';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { PARAGRAPH_1000 } from '../fixtures/texts';
import { openFreshBoard, setCamera, settle, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './helpers/board';

const CENTER = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function notes(page: Page) {
  return page.getByRole('group', { name: 'Sticky note' });
}

async function createNoteAt(page: Page, x: number, y: number): Promise<string> {
  await page.mouse.dblclick(x, y);
  await settle(page);
  const testId = await notes(page).last().getAttribute('data-testid');
  return (testId ?? '').replace('sticky-', '');
}

async function worldPos(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((testId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
    const style = getComputedStyle(el);
    return { x: parseFloat(style.left), y: parseFloat(style.top) };
  }, `sticky-${id}`);
}

async function fontSizeOfNote(page: Page, id: string): Promise<number> {
  return page.evaluate((testId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
    return parseFloat(getComputedStyle(el).fontSize);
  }, `sticky-text-${id}`);
}

async function dragNote(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await settle(page);
  await page.mouse.up();
  await settle(page);
}

async function centerOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`sticky-${id}`).boundingBox();
  if (box === null) throw new Error('note not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function endEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
}

test.describe('workflow: brainstorm golden path', () => {
  test('TC-30 double-click creates a note centred at the cursor with typed text', async ({ page }) => {
    await openFreshBoard(page);
    const id = await createNoteAt(page, 400, 300);
    await page.keyboard.type('Hello');
    await endEditing(page);
    const center = await centerOf(page, id);
    expect(Math.abs(center.x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 300)).toBeLessThanOrEqual(1);
    const text = await page.getByTestId(`sticky-text-${id}`).textContent();
    expect(text).toBe('Hello');
  });

  test('TC-31 at 50% zoom a note drags to keep the grabbed point under the pointer, then recolour and delete', async ({
    page
  }) => {
    await openFreshBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    const id = await createNoteAt(page, CENTER.x, CENTER.y);
    await endEditing(page);
    const before = await centerOf(page, id);
    const worldBefore = await worldPos(page, id);
    await dragNote(page, before, 100, 50);
    const after = await centerOf(page, id);
    // Screen: the grabbed point (centre) follows the pointer exactly.
    expect(Math.abs(after.x - (before.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 50))).toBeLessThanOrEqual(1);
    // World: screen delta divided by 0.5 => doubled.
    const worldAfter = await worldPos(page, id);
    expect(Math.abs(worldAfter.x - (worldBefore.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(worldAfter.y - (worldBefore.y + 100))).toBeLessThanOrEqual(1);
    // Recolour via the note toolbar swatch.
    await page.getByRole('button', { name: 'Green colour' }).click();
    await settle(page);
    const bg = await page.evaluate((testId) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
      return getComputedStyle(el).backgroundColor;
    }, `sticky-${id}`);
    expect(bg).toBe(hexToRgb(STICKY_COLORS.green));
    // Delete via keyboard removes the note.
    await page.keyboard.press('Delete');
    await settle(page);
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-32 at 200% zoom a drag gives half the world delta and the dragged note is drawn above', async ({
    page
  }) => {
    await openFreshBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    // Two notes that overlap on their inner edges (note width = 200 world = 400 px).
    const idA = await createNoteAt(page, CENTER.x, CENTER.y);
    await endEditing(page);
    await createNoteAt(page, CENTER.x + 220, CENTER.y);
    await endEditing(page);
    const idB = await page.evaluate((a) => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[role="group"][aria-label="Sticky note"]')).find(
        (e) => e.getAttribute('data-testid') !== `sticky-${a}`
      )!;
      return (el.getAttribute('data-testid') ?? '').replace('sticky-', '');
    }, idA);

    // Grab note A on its exposed left edge (well inside A, outside B) so the
    // pointer-down reliably targets the lower note.
    const aCenter = await centerOf(page, idA);
    const worldBefore = await worldPos(page, idA);
    await dragNote(page, { x: aCenter.x - 150, y: aCenter.y }, 100, 50);
    const worldAfter = await worldPos(page, idA);
    expect(Math.abs(worldAfter.x - (worldBefore.x + 50))).toBeLessThanOrEqual(1);
    expect(Math.abs(worldAfter.y - (worldBefore.y + 25))).toBeLessThanOrEqual(1);

    // The dragged note was brought to the front: at an overlap the top hit is A
    // (the selected note), not B.
    const overlap = await centerOf(page, idB);
    const top = await page.evaluate((point) => {
      const el = document.elementFromPoint(point.x, point.y);
      const group = el?.closest('[role="group"]');
      return { selected: group?.getAttribute('data-selected') };
    }, overlap);
    expect(top.selected).toBe('true');
  });


  test('TC-33 long text auto-fits: one word is max size, a 1,000-char paragraph shrinks and fades', async ({
    page
  }) => {
    await openFreshBoard(page);
    const id = await createNoteAt(page, CENTER.x, CENTER.y);
    await page.keyboard.type('Retro');
    await endEditing(page);
    expect(await fontSizeOfNote(page, id)).toBe(STICKY_FONT_MAX_PX);
    // Re-enter editing and replace the content with the 1,000-char fixture.
    await page.getByTestId(`sticky-${id}`).dblclick();
    await settle(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(PARAGRAPH_1000);
    await endEditing(page);
    const size = await fontSizeOfNote(page, id);
    expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(size).toBeLessThan(STICKY_FONT_MAX_PX);
    await expect(page.getByTestId('sticky-fade')).toBeVisible();
    // The note keeps its fixed size and clips its content: nothing is painted
    // outside the note box (body overflow hidden, no horizontal overflow).
    const geom = await page.evaluate((testId) => {
      const note = document.querySelector<HTMLElement>(`[data-testid="sticky-${testId}"]`)!;
      const text = document.querySelector<HTMLElement>(`[data-testid="sticky-text-${testId}"]`)!;
      const body = text.parentElement as HTMLElement;
      const nb = note.getBoundingClientRect();
      const tb = text.getBoundingClientRect();
      return {
        noteW: nb.width,
        noteH: nb.height,
        overflow: getComputedStyle(body).overflow,
        noHorizontalOverflow: tb.width <= nb.width + 1
      };
    }, id);
    expect(Math.abs(geom.noteW - STICKY_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(geom.noteH - STICKY_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(geom.overflow).toBe('hidden');
    expect(geom.noHorizontalOverflow).toBe(true);
  });

  test('TC-34 panned far away, the Sticky note button drops a note at the screen centre', async ({ page }) => {
    await openFreshBoard(page);
    await setCamera(page, { x: 500000, y: -250000, zoom: 1 });
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await settle(page);
    await expect(notes(page)).toHaveCount(1);
    const id = (await notes(page).first().getAttribute('data-testid') ?? '').replace('sticky-', '');
    const center = await centerOf(page, id);
    expect(Math.abs(center.x - CENTER.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(center.y - CENTER.y)).toBeLessThanOrEqual(2);
  });
});
